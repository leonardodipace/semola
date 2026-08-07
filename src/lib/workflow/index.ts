import { mightThrow } from "../errors/index.js";
import { WorkflowEngine } from "./engine.js";
import {
  DuplicateWorkflowError,
  NotFoundError,
  WorkflowStoreError,
} from "./errors.js";
import { isTerminalStatus, parseHistory } from "./history.js";
import { fromJson, toJson } from "./json.js";
import { WorkflowStore } from "./store.js";
import type {
  ResolvePartitionKeyInput,
  StepSnapshot,
  Workflow,
  WorkflowListItem,
  WorkflowListOptions,
  WorkflowOptions,
  WorkflowStartOptions,
  WorkflowStatus,
} from "./types.js";

const registry = new Set<string>();

const optionalTimestamp = (raw: string) => {
  if (!raw) return null;

  return Number(raw);
};

const toFilter = <T extends string>(value: T | T[] | undefined) => {
  if (value === undefined) return null;

  if (Array.isArray(value)) return new Set(value);

  return new Set([value]);
};

export const listWorkflows = async (
  redis: Bun.RedisClient,
  options?: WorkflowListOptions,
) => {
  const names = toFilter(options?.name);
  const statuses = toFilter(options?.status);
  const results: WorkflowListItem[] = [];

  let match = "workflow:*:meta:*";

  if (typeof options?.name === "string") {
    match = `workflow:${options.name}:meta:*`;
  }

  let cursor = "0";

  do {
    const [scanError, scanned] = await mightThrow(
      redis.scan(cursor, "MATCH", match, "COUNT", 100),
    );

    if (scanError) {
      throw new WorkflowStoreError("Unable to scan workflow executions");
    }

    if (!scanned) {
      throw new WorkflowStoreError("Unable to scan workflow executions");
    }

    const [next, keys] = scanned;

    cursor = next;

    for (const key of keys) {
      const id = key.split(":meta:")[1];

      if (!id) continue;

      const [readError, meta] = await mightThrow(redis.hgetall(key));

      if (readError) {
        throw new WorkflowStoreError(
          `Unable to read metadata for execution ${id}`,
        );
      }

      if (!meta?.name) continue;
      if (!meta.status) continue;
      if (names && !names.has(meta.name)) continue;
      if (statuses && !statuses.has(meta.status as WorkflowStatus)) continue;
      if (!meta.createdAt) continue;
      if (!meta.updatedAt) continue;

      results.push({
        id,
        name: meta.name,
        status: meta.status as WorkflowStatus,
        createdAt: Number(meta.createdAt),
        updatedAt: Number(meta.updatedAt),
        completedAt: optionalTimestamp(meta.completedAt ?? ""),
        failedAt: optionalTimestamp(meta.failedAt ?? ""),
        cancelledAt: optionalTimestamp(meta.cancelledAt ?? ""),
      });
    }
  } while (cursor !== "0");

  return results;
};

const requireMeta = async (store: WorkflowStore, executionId: string) => {
  const meta = await store.getMeta(executionId);

  if (!meta) {
    throw new NotFoundError(`Workflow execution ${executionId} not found`);
  }

  return meta;
};

const resolvePartitionKey = <TInput, TResult>(
  input: ResolvePartitionKeyInput<TInput, TResult>,
) => {
  const { options, input: workflowInput, startOptions } = input;

  if (startOptions.partitionKey !== undefined) {
    if (!startOptions.partitionKey) {
      throw new WorkflowStoreError("Partition key must be a non-empty string");
    }

    return startOptions.partitionKey;
  }

  if (!options.partitionBy) {
    // Shared default key → concurrency is cluster-wide across replicas.
    return "*";
  }

  const partitionKey = options.partitionBy(workflowInput);

  if (!partitionKey) {
    throw new WorkflowStoreError("Partition key must be a non-empty string");
  }

  return partitionKey;
};

const resolveExecutionId = (startOptions: WorkflowStartOptions) => {
  if (startOptions.executionId === undefined) {
    return crypto.randomUUID();
  }

  if (!startOptions.executionId) {
    throw new WorkflowStoreError("Execution id must be a non-empty string");
  }

  if (startOptions.executionId.includes(":")) {
    throw new WorkflowStoreError('Execution id must not contain ":"');
  }

  return startOptions.executionId;
};

export const defineWorkflow = <TInput, TResult = void>(
  options: WorkflowOptions<TInput, TResult>,
): Workflow<TInput, TResult> => {
  if (registry.has(options.name)) {
    throw new DuplicateWorkflowError(
      `Workflow "${options.name}" is already defined in this process`,
    );
  }

  const store = new WorkflowStore(options.redis, options.name);
  const engine = new WorkflowEngine(options, store);
  engine.start();

  const start = async (
    input: TInput,
    startOptions: WorkflowStartOptions = {},
  ) => {
    const executionId = resolveExecutionId(startOptions);
    const partitionKey = resolvePartitionKey({ options, input, startOptions });
    const serializedInput = toJson(input, "input");
    const now = Date.now();

    const created = await store.tryCreateMetaAndActive(executionId, {
      name: options.name,
      status: "pending",
      input: serializedInput,
      result: "",
      error: "",
      createdAt: String(now),
      updatedAt: String(now),
      completedAt: "",
      failedAt: "",
      cancelledAt: "",
      partitionKey,
      partitionSlot: "",
      concurrencySlot: "",
    });

    if (!created) {
      throw new WorkflowStoreError(
        `Workflow execution ${executionId} already exists`,
      );
    }

    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowStarted",
          input: serializedInput,
          partitionKey,
          timestamp: now,
        },
      ],
    });

    await store.enqueue(executionId);

    return {
      executionId,
      status: "pending" as WorkflowStatus,
    };
  };

  const resume = async (executionId: string) => {
    const meta = await requireMeta(store, executionId);

    if (meta.status !== "failed") {
      throw new WorkflowStoreError(
        `Workflow execution ${executionId} is ${meta.status}, only failed executions can be resumed`,
      );
    }

    const now = Date.now();
    const view = parseHistory(await store.loadHistory(executionId));
    const retryEvents = [];

    for (const [stepId, state] of view.steps) {
      if (state.status !== "failed") continue;

      retryEvents.push({
        type: "StepScheduled" as const,
        stepId,
        stepName: state.stepName,
        attempt: 1,
        timestamp: now,
      });
    }

    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowResumed",
          timestamp: now,
        },
        ...retryEvents,
      ],
    });

    // Atomic pending + active: crash between flip and markActive would orphan
    // (pending but reclaim-blind).
    await store.updateStatusAndMarkActive({
      executionId,
      status: "pending",
      extra: {
        error: "",
        failedAt: "",
      },
    });

    await store.enqueue(executionId);

    return {
      executionId,
      status: "pending" as WorkflowStatus,
    };
  };

  const get = async (executionId: string) => {
    const meta = await requireMeta(store, executionId);
    const input = fromJson<TInput>(meta.input, "input");
    const view = parseHistory(await store.loadHistory(executionId));
    const steps: StepSnapshot[] = [];

    for (const state of view.steps.values()) {
      if (state.status !== "completed") continue;

      steps.push({
        name: state.stepName,
        completedAt: state.completedAt,
      });
    }

    let result: TResult | null = null;

    if (meta.result) {
      result = fromJson<TResult>(meta.result, "result");
    }

    let error: string | null = null;

    if (meta.error) {
      error = meta.error;
    }

    return {
      id: executionId,
      name: meta.name,
      status: meta.status as WorkflowStatus,
      input,
      result,
      error,
      createdAt: Number(meta.createdAt),
      updatedAt: Number(meta.updatedAt),
      completedAt: optionalTimestamp(meta.completedAt),
      failedAt: optionalTimestamp(meta.failedAt),
      cancelledAt: optionalTimestamp(meta.cancelledAt),
      steps,
    };
  };

  const cancel = async (executionId: string) => {
    const meta = await requireMeta(store, executionId);

    if (isTerminalStatus(meta.status)) {
      return {
        status: meta.status as WorkflowStatus,
        executionId,
        updatedAt: Number(meta.updatedAt),
        cancelledAt: optionalTimestamp(meta.cancelledAt),
        createdAt: Number(meta.createdAt),
      };
    }

    const now = Date.now();

    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowCancelRequested",
          timestamp: now,
        },
      ],
    });

    engine.requestAbort(executionId);
    await store.enqueue(executionId);

    return {
      status: meta.status as WorkflowStatus,
      executionId,
      updatedAt: Number(meta.updatedAt),
      cancelledAt: optionalTimestamp(meta.cancelledAt),
      createdAt: Number(meta.createdAt),
    };
  };

  const stop = async () => {
    await engine.stop();
    registry.delete(options.name);
  };

  registry.add(options.name);

  return {
    name: options.name,
    start,
    resume,
    get,
    cancel,
    stop,
  };
};

export {
  DuplicateWorkflowError,
  NonRetryableStepError,
  NotFoundError,
  SerializationError,
  WorkflowStoreError,
} from "./errors.js";

export type {
  StepContext,
  StepHandler,
  StepSnapshot,
  Workflow,
  WorkflowCancelResult,
  WorkflowExecution,
  WorkflowHandlerContext,
  WorkflowHooks,
  WorkflowListItem,
  WorkflowListOptions,
  WorkflowOptions,
  WorkflowRetryBackoff,
  WorkflowStartOptions,
  WorkflowStartResult,
  WorkflowStatus,
  WorkflowStepErrorContext,
  WorkflowStepErrorRecord,
  WorkflowStepRetryContext,
} from "./types.js";

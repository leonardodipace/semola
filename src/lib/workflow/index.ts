import { mightThrow } from "../errors/index.js";
import { WorkflowEngine } from "./engine.js";
import {
  DuplicateWorkflowError,
  NotFoundError,
  WorkflowStoreError,
} from "./errors.js";
import { parseHistory } from "./history.js";
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
  WorkflowStartSyncOptions,
  WorkflowStartSyncResult,
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

    const [next, keys] = scanned;

    cursor = next;

    for (const key of keys) {
      const marker = ":meta:";
      const index = key.lastIndexOf(marker);

      if (index === -1) continue;

      const id = key.slice(index + marker.length);

      if (!id) continue;

      const [readError, meta] = await mightThrow(redis.hgetall(key));

      if (readError) {
        throw new WorkflowStoreError(
          `Unable to read metadata for execution ${id}`,
        );
      }

      if (!meta) continue;
      if (Object.keys(meta).length === 0) continue;
      if (!meta.name) continue;
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

  if (!options.partitionBy) return "*";

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

  const createExecution = async (
    input: TInput,
    startOptions: WorkflowStartOptions = {},
  ) => {
    const executionId = resolveExecutionId(startOptions);
    const partitionKey = resolvePartitionKey({ options, input, startOptions });
    const serializedInput = toJson(input, "input");
    const now = Date.now();

    const created = await store.createExecution(executionId, {
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
      cancelRequestedAt: "",
    });

    if (!created) {
      return { executionId, created: false as const };
    }

    return { executionId, created: true as const };
  };

  const start = async (
    input: TInput,
    startOptions: WorkflowStartOptions = {},
  ) => {
    const { executionId, created } = await createExecution(input, startOptions);

    if (!created) {
      throw new WorkflowStoreError(
        `Workflow execution ${executionId} already exists`,
      );
    }

    return {
      executionId,
      status: "pending" as WorkflowStatus,
    };
  };

  // One script decides and applies the resume; replay restarts the failed
  // steps at attempt 1 (see WorkflowResumed in history.ts).
  const resume = async (executionId: string) => {
    const outcome = await store.resumeExecution(executionId);

    if (outcome === null) {
      throw new NotFoundError(`Workflow execution ${executionId} not found`);
    }

    if (outcome === "unwound") {
      throw new WorkflowStoreError(
        `Workflow execution ${executionId} cannot be resumed after compensation`,
      );
    }

    if (outcome !== "resumed") {
      throw new WorkflowStoreError(
        `Workflow execution ${executionId} is ${outcome}, only failed executions can be resumed`,
      );
    }

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
    // One script decides and records the request, so a run that turns
    // terminal or starts compensating concurrently is never overridden.
    const request = await store.requestCancel(executionId);

    if (!request) {
      throw new NotFoundError(`Workflow execution ${executionId} not found`);
    }

    if (request.accepted) engine.requestAbort(executionId);

    return {
      status: request.status,
      executionId,
      updatedAt: Number(request.updatedAt),
      cancelledAt: optionalTimestamp(request.cancelledAt),
      createdAt: Number(request.createdAt),
    };
  };

  const startSync = async (
    input: TInput,
    syncOptions: WorkflowStartSyncOptions = {},
  ): Promise<WorkflowStartSyncResult<TResult>> => {
    const { timeoutMs, cancelOnTimeout, ...startOptions } = syncOptions;

    if (timeoutMs !== undefined) {
      if (!Number.isFinite(timeoutMs)) {
        throw new WorkflowStoreError("timeoutMs must be a finite number");
      }

      if (timeoutMs < 0) {
        throw new WorkflowStoreError("timeoutMs must be a non-negative number");
      }
    }

    const { executionId } = await createExecution(input, startOptions);
    const pollInterval = options.pollInterval ?? 100;
    let deadline: number | undefined;
    let deadlineRechecked = false;

    if (timeoutMs !== undefined) {
      deadline = Date.now() + timeoutMs;
    }

    while (true) {
      // Meta alone decides the outcome; get() would also load the history.
      const meta = await requireMeta(store, executionId);

      if (meta.status === "completed") {
        return {
          executionId,
          status: "completed",
          result: meta.result ? fromJson<TResult>(meta.result, "result") : null,
          error: null,
        };
      }

      if (meta.status === "cancelled") {
        return {
          executionId,
          status: "cancelled",
          result: null,
          error: null,
        };
      }

      if (meta.status === "failed") {
        return {
          executionId,
          status: "failed",
          result: null,
          error: new Error(
            meta.originalError || meta.error || "workflow failed",
          ),
        };
      }

      if (deadline !== undefined) {
        if (Date.now() >= deadline) {
          // One more poll so a terminal transition that raced the deadline
          // is not reported as timeout.
          if (!deadlineRechecked) {
            deadlineRechecked = true;
            continue;
          }

          if (cancelOnTimeout) await cancel(executionId);

          return {
            executionId,
            status: "timeout",
            result: null,
            error: null,
          };
        }

        await Bun.sleep(Math.min(pollInterval, deadline - Date.now()));
        continue;
      }

      await Bun.sleep(pollInterval);
    }
  };

  const stop = async () => {
    await engine.stop();
    registry.delete(options.name);
  };

  registry.add(options.name);

  return {
    name: options.name,
    start,
    startSync,
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
  StepCompensateContext,
  StepCompensateHandler,
  StepContext,
  StepHandler,
  StepOptions,
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
  WorkflowStartSyncOptions,
  WorkflowStartSyncResult,
  WorkflowStartSyncStatus,
  WorkflowStatus,
  WorkflowStepErrorContext,
  WorkflowStepErrorRecord,
  WorkflowStepRetryContext,
} from "./types.js";

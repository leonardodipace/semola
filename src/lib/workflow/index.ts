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
  HistoryEvent,
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
const RESUME_ATTEMPTS = 3;

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
      partitionSlot: "",
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

  const notResumable = (executionId: string, status: string) =>
    new WorkflowStoreError(
      `Workflow execution ${executionId} is ${status}, only failed executions can be resumed`,
    );

  const resume = async (executionId: string) => {
    // The resume script only applies if status is still failed and history
    // has not grown since this read; otherwise re-read and decide again.
    for (let attempt = 0; attempt < RESUME_ATTEMPTS; attempt++) {
      const meta = await requireMeta(store, executionId);
      const history = await store.loadHistory(executionId);
      const view = parseHistory(history);

      if (view.compensation) {
        throw new WorkflowStoreError(
          `Workflow execution ${executionId} cannot be resumed after compensation`,
        );
      }

      if (meta.status !== "failed") {
        throw notResumable(executionId, meta.status);
      }

      const now = Date.now();
      const events: HistoryEvent[] = [
        {
          type: "WorkflowResumed",
          timestamp: now,
        },
      ];

      for (const [stepId, state] of view.steps) {
        if (state.status !== "failed") continue;

        events.push({
          type: "StepScheduled",
          stepId,
          stepName: state.stepName,
          attempt: 1,
          timestamp: now,
        });
      }

      const resumed = await store.resumeExecution({
        executionId,
        historyLength: history.length,
        events,
      });

      if (resumed) {
        return {
          executionId,
          status: "pending" as WorkflowStatus,
        };
      }
    }

    throw new WorkflowStoreError(
      `Workflow execution ${executionId} changed while resuming, try again`,
    );
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

    const snapshot = (status = meta.status as WorkflowStatus) => ({
      status,
      executionId,
      updatedAt: Number(meta.updatedAt),
      cancelledAt: optionalTimestamp(meta.cancelledAt),
      createdAt: Number(meta.createdAt),
    });

    if (isTerminalStatus(meta.status)) return snapshot();

    if (meta.status === "compensating") return snapshot();

    const view = parseHistory(await store.loadHistory(executionId));

    if (view.compensation) return snapshot("compensating");

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

    return snapshot();
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
      const execution = await get(executionId);

      if (execution.status === "completed") {
        return {
          executionId,
          status: "completed",
          result: execution.result,
          error: null,
        };
      }

      if (execution.status === "cancelled") {
        return {
          executionId,
          status: "cancelled",
          result: null,
          error: null,
        };
      }

      if (execution.status === "failed") {
        const view = parseHistory(await store.loadHistory(executionId));
        let message = execution.error ?? "workflow failed";

        if (view.compensation?.error) {
          message = view.compensation.error;
        } else if (view.terminal?.kind === "failed") {
          message = view.terminal.error;
        }

        return {
          executionId,
          status: "failed",
          result: null,
          error: new Error(message),
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

import {
  DuplicateWorkflowError,
  NotFoundError,
  WorkflowStoreError,
} from "./errors.js";
import { isTerminalStatus, parseHistory } from "./history.js";
import { deserializeWith, serializeWith } from "./runtime.js";
import { WorkflowStore } from "./store.js";
import type {
  Workflow,
  WorkflowOptions,
  WorkflowStartOptions,
  WorkflowStatus,
} from "./types.js";
import { parseStepSnapshots, WorkflowWorker } from "./worker.js";

// Process-local only: blocks duplicate defineWorkflow(name) in this process.
const registry = new Set<string>();

const optionalTimestamp = (raw: string) => {
  if (!raw) return null;

  return Number(raw);
};

const requireMeta = async (store: WorkflowStore, executionId: string) => {
  const meta = await store.getMeta(executionId);

  if (!meta) {
    throw new NotFoundError(`Workflow execution ${executionId} not found`);
  }

  return meta;
};

const resolvePartitionKey = <TInput, TResult>(
  options: WorkflowOptions<TInput, TResult>,
  input: TInput,
  startOptions: WorkflowStartOptions,
) => {
  if (startOptions.partitionKey !== undefined) {
    if (!startOptions.partitionKey) {
      throw new WorkflowStoreError("Partition key must be a non-empty string");
    }

    return startOptions.partitionKey;
  }

  if (!options.partitionBy) {
    return "";
  }

  const partitionKey = options.partitionBy(input);

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
  const worker = new WorkflowWorker(options, store);
  worker.start();

  const start = async (
    input: TInput,
    startOptions: WorkflowStartOptions = {},
  ) => {
    const executionId = resolveExecutionId(startOptions);
    const partitionKey = resolvePartitionKey(options, input, startOptions);
    const serializedInput = serializeWith(
      input,
      options.serializeInput,
      "input",
    );
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
      steps: "[]",
      partitionKey,
      partitionSlot: "",
    });

    if (!created) {
      throw new WorkflowStoreError(
        `Workflow execution ${executionId} already exists`,
      );
    }

    await store.appendEvents(executionId, [
      {
        type: "WorkflowStarted",
        input: serializedInput,
        partitionKey,
        timestamp: now,
      },
    ]);

    await store.enqueueWorkflow(executionId);

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

    await store.appendEvents(executionId, [
      {
        type: "WorkflowResumed",
        timestamp: now,
      },
    ]);

    // Leave failed before enqueue: step workers drop terminal tasks.
    await store.updateStatus(executionId, "pending", {
      error: "",
      failedAt: "",
    });

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

    if (retryEvents.length > 0) {
      await store.appendEvents(executionId, retryEvents);

      for (const event of retryEvents) {
        await store.enqueueStep({
          executionId,
          stepId: event.stepId,
          stepName: event.stepName,
          attempt: event.attempt,
        });
      }
    }

    await store.markActive(executionId);
    await store.enqueueWorkflow(executionId);

    return {
      executionId,
      status: "pending" as WorkflowStatus,
    };
  };

  const get = async (executionId: string) => {
    const meta = await requireMeta(store, executionId);

    const input = deserializeWith(
      meta.input,
      options.deserializeInput,
      "input",
    );

    let result: TResult | null = null;

    if (meta.result) {
      result = deserializeWith(
        meta.result,
        options.deserializeResult,
        "result",
      );
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
      steps: parseStepSnapshots(meta.steps),
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

    await store.appendEvents(executionId, [
      {
        type: "WorkflowCancelRequested",
        timestamp: now,
      },
    ]);

    worker.requestAbort(executionId);
    await store.enqueueWorkflow(executionId);

    return {
      status: meta.status as WorkflowStatus,
      executionId,
      updatedAt: now,
      cancelledAt: optionalTimestamp(meta.cancelledAt),
      createdAt: Number(meta.createdAt),
    };
  };

  const stop = async () => {
    await worker.stop();
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
  WorkflowOptions,
  WorkflowRetryBackoff,
  WorkflowStartOptions,
  WorkflowStartResult,
  WorkflowStatus,
  WorkflowStepErrorContext,
  WorkflowStepErrorRecord,
  WorkflowStepRetryContext,
} from "./types.js";

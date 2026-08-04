import { mightThrow } from "../errors/index.js";
import {
  lockKeyFor,
  META_KEY_PREFIX,
  META_KEY_SUFFIX,
  metaKeyFor,
  normalizeStatusValue,
  normalizeToSet,
  parseExecutionIdFromMetaKey,
  parseOptionalNumber,
  WorkflowDefinition,
} from "./definition.js";
import { NotFoundError, StateError, WorkflowError } from "./errors.js";
import type {
  Workflow,
  WorkflowListItem,
  WorkflowListOptions,
  WorkflowOptions,
  WorkflowRecoverOptions,
  WorkflowStatus,
} from "./types.js";

const workflowRegistry = new Map<string, Workflow<unknown, unknown>>();

export const clearWorkflowRegistry = async () => {
  const workflows = [...workflowRegistry.values()];
  workflowRegistry.clear();

  for (const workflow of workflows) {
    await workflow.stop();
  }
};

const readListItem = async (
  redis: Bun.RedisClient,
  key: string,
  nameFilter: Set<string> | null,
  statusFilter: Set<WorkflowStatus> | null,
  unlockedOnly: boolean,
) => {
  const executionId = parseExecutionIdFromMetaKey(key);

  if (!executionId) {
    return null;
  }

  const [readError, meta] = await mightThrow(redis.hgetall(key));

  if (readError) {
    throw new WorkflowError(
      `Unable to read metadata for execution ${executionId}`,
    );
  }

  if (!meta) {
    return null;
  }

  const name = meta.name;

  if (!name) {
    return null;
  }

  if (nameFilter) {
    if (!nameFilter.has(name)) {
      return null;
    }
  }

  const statusRaw = meta.status;

  if (!statusRaw) {
    return null;
  }

  const status = normalizeStatusValue(statusRaw);

  if (!status) {
    return null;
  }

  if (statusFilter) {
    if (!statusFilter.has(status)) {
      return null;
    }
  }

  if (unlockedOnly) {
    const [existsError, lockExists] = await mightThrow(
      redis.exists(lockKeyFor(executionId)),
    );

    if (existsError) {
      throw new WorkflowError(
        `Unable to read lock for execution ${executionId}`,
      );
    }

    if (lockExists) {
      return null;
    }
  }

  const createdAt = parseOptionalNumber(meta.createdAt, "createdAt");
  const updatedAt = parseOptionalNumber(meta.updatedAt, "updatedAt");

  if (createdAt === null) {
    throw new StateError(
      `Workflow execution ${executionId} is missing createdAt`,
    );
  }

  if (updatedAt === null) {
    throw new StateError(
      `Workflow execution ${executionId} is missing updatedAt`,
    );
  }

  return {
    id: executionId,
    name,
    status,
    createdAt,
    updatedAt,
    completedAt: parseOptionalNumber(meta.completedAt, "completedAt"),
    failedAt: parseOptionalNumber(meta.failedAt, "failedAt"),
    cancelledAt: parseOptionalNumber(meta.cancelledAt, "cancelledAt"),
  } satisfies WorkflowListItem;
};

export const listWorkflows = async (
  redis: Bun.RedisClient,
  options?: WorkflowListOptions,
) => {
  const nameFilter = normalizeToSet(options?.name);
  const statusFilter = normalizeToSet(options?.status);
  const unlockedOnly = options?.unlockedOnly === true;
  const results: WorkflowListItem[] = [];
  let cursor = "0";

  do {
    const [scanError, scanResult] = await mightThrow(
      redis.scan(
        cursor,
        "MATCH",
        `${META_KEY_PREFIX}*${META_KEY_SUFFIX}`,
        "COUNT",
        100,
      ),
    );

    if (scanError) {
      throw new WorkflowError("Unable to scan workflow executions");
    }

    if (!scanResult) {
      throw new WorkflowError("Unable to scan workflow executions");
    }

    const [nextCursor, keys] = scanResult;
    cursor = nextCursor;

    for (const key of keys) {
      const item = await readListItem(
        redis,
        key,
        nameFilter,
        statusFilter,
        unlockedOnly,
      );

      if (!item) {
        continue;
      }

      results.push(item);
    }
  } while (cursor !== "0");

  return results;
};

const processingKeyFor = (name: string) => {
  return `workflow:${name}:processing`;
};

export const recoverOrphanedWorkflows = async (
  redis: Bun.RedisClient,
  options?: WorkflowRecoverOptions,
) => {
  const nameFilter = normalizeToSet(options?.name);
  const recoveredIds = new Set<string>();

  const names =
    nameFilter === null ? [...workflowRegistry.keys()] : [...nameFilter];

  for (const name of names) {
    const processingKey = processingKeyFor(name);

    const [rangeError, ids] = await mightThrow(
      redis.lrange(processingKey, 0, -1),
    );

    if (rangeError) {
      throw new WorkflowError(
        `Unable to read processing list for workflow ${name}`,
      );
    }

    if (!ids) {
      continue;
    }

    for (const executionId of ids) {
      if (typeof executionId !== "string") {
        continue;
      }

      if (executionId.length === 0) {
        continue;
      }

      if (recoveredIds.has(executionId)) {
        continue;
      }

      const [existsError, lockExists] = await mightThrow(
        redis.exists(lockKeyFor(executionId)),
      );

      if (existsError) {
        throw new WorkflowError(
          `Unable to read lock for execution ${executionId}`,
        );
      }

      if (lockExists) {
        continue;
      }

      const [statusError, statusRaw] = await mightThrow(
        redis.hget(metaKeyFor(executionId), "status"),
      );

      if (statusError) {
        throw new WorkflowError(
          `Unable to read status for execution ${executionId}`,
        );
      }

      await mightThrow(redis.lrem(processingKey, 1, executionId));

      if (statusRaw !== "pending") {
        if (statusRaw !== "running") {
          continue;
        }
      }

      if (!workflowRegistry.has(name)) {
        continue;
      }

      const [resumeError] = await mightThrow(
        resumeWorkflow(redis, executionId),
      );

      if (resumeError) {
        continue;
      }

      recoveredIds.add(executionId);
    }
  }

  const orphans = await listWorkflows(redis, {
    name: options?.name,
    status: ["pending", "running"],
    unlockedOnly: true,
  });

  for (const item of orphans) {
    if (recoveredIds.has(item.id)) {
      continue;
    }

    if (!workflowRegistry.has(item.name)) {
      continue;
    }

    const [resumeError] = await mightThrow(resumeWorkflow(redis, item.id));

    if (resumeError) {
      continue;
    }

    recoveredIds.add(item.id);
  }

  return [...recoveredIds];
};

export const resumeWorkflow = async (
  redis: Bun.RedisClient,
  executionId: string,
) => {
  const [readError, name] = await mightThrow(
    redis.hget(metaKeyFor(executionId), "name"),
  );

  if (readError) {
    throw new WorkflowError(`Unable to read name for execution ${executionId}`);
  }

  if (!name) {
    throw new NotFoundError(`Workflow execution ${executionId} not found`);
  }

  if (typeof name !== "string") {
    throw new StateError(`Invalid name value for execution ${executionId}`);
  }

  const workflow = workflowRegistry.get(name);

  if (!workflow) {
    throw new NotFoundError(
      `Workflow ${name} is not registered in this process`,
    );
  }

  return workflow.resume(executionId);
};

export const defineWorkflow = <TInput, TResult = void>(
  options: WorkflowOptions<TInput, TResult>,
): Workflow<TInput, TResult> => {
  if (workflowRegistry.has(options.name)) {
    throw new StateError(
      `Workflow ${options.name} is already registered in this process`,
    );
  }

  const workflow = new WorkflowDefinition(options);

  const api: Workflow<TInput, TResult> = {
    name: options.name,
    start: (input, startOptions) => workflow.start(input, startOptions),
    resume: (executionId) => workflow.resume(executionId),
    get: (executionId) => workflow.get(executionId),
    cancel: (executionId) => workflow.cancel(executionId),
    stop: () => workflow.stop(),
  };

  workflowRegistry.set(options.name, api as Workflow<unknown, unknown>);

  return api;
};

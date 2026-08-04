import assert from "node:assert";
import { mightThrow, mightThrowSync } from "../errors/index.js";
import {
  CancelledError,
  ExecutionError,
  LockError,
  NotFoundError,
  PartitionError,
  SerializationError,
  StateError,
  StepFailedError,
  WorkflowError,
} from "./errors.js";
import type {
  StepHandler,
  StepSnapshot,
  Workflow,
  WorkflowCancelResult,
  WorkflowExecution,
  WorkflowListItem,
  WorkflowListOptions,
  WorkflowMeta,
  WorkflowMetaField,
  WorkflowOptions,
  WorkflowRecoverOptions,
  WorkflowStartOptions,
  WorkflowStartResult,
  WorkflowStatus,
  WorkflowStepErrorRecord,
} from "./types.js";

const DEFAULT_LOCK_TTL = 5 * 60 * 1000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY = 1000;
const DEFAULT_RETRY_MULTIPLIER = 2;
const DEFAULT_RETRY_MAX_DELAY = 30000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_POLL_INTERVAL = 100;
const DEFAULT_RECOVERY_INTERVAL_MS = 30000;
const SHUTDOWN_POLL_INTERVAL = 10;
const META_KEY_PREFIX = "workflow:execution:";
const META_KEY_SUFFIX = ":meta";

const knownStatuses: WorkflowStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];

const workflowRegistry = new Map<string, Workflow<unknown, unknown>>();

const now = () => Date.now();

const executionKey = (executionId: string) => {
  return `${META_KEY_PREFIX}${executionId}`;
};

const metaKeyFor = (executionId: string) => {
  return `${executionKey(executionId)}${META_KEY_SUFFIX}`;
};

const lockKeyFor = (executionId: string) => {
  return `${executionKey(executionId)}:lock`;
};

const parseExecutionIdFromMetaKey = (key: string) => {
  if (!key.startsWith(META_KEY_PREFIX)) {
    return null;
  }

  if (!key.endsWith(META_KEY_SUFFIX)) {
    return null;
  }

  return key.slice(META_KEY_PREFIX.length, -META_KEY_SUFFIX.length);
};

const normalizeToSet = <T extends string>(value: T | T[] | undefined) => {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return new Set(value);
  }

  return new Set([value]);
};

const parseOptionalNumber = (value: string | undefined, field: string) => {
  if (value === undefined) {
    return null;
  }

  if (value.length === 0) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new StateError(`Invalid ${field} value`);
  }

  return parsed;
};

const normalizeStatusValue = (value: string) => {
  for (const status of knownStatuses) {
    if (status === value) {
      return status;
    }
  }

  return null;
};

const delay = async (
  ms: number,
  signal: AbortSignal,
  isCancelled?: () => Promise<boolean>,
) => {
  if (signal.aborted) {
    throw new CancelledError(
      "Workflow execution was aborted during retry backoff",
    );
  }

  const deadline = now() + ms;
  const pollInterval = 50;

  while (now() < deadline) {
    if (signal.aborted) {
      throw new CancelledError(
        "Workflow execution was aborted during retry backoff",
      );
    }

    if (isCancelled) {
      const cancelled = await isCancelled();

      if (cancelled) {
        throw new CancelledError(
          "Workflow execution was cancelled during retry backoff",
        );
      }
    }

    const remaining = deadline - now();

    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(pollInterval, remaining));
    });
  }
};

const envelopeSerialize = (value: unknown) => {
  return JSON.stringify({ value });
};

const envelopeDeserialize = (raw: string) => {
  const [parseError, parsed] = mightThrowSync(() => JSON.parse(raw));

  if (parseError) {
    throw parseError;
  }

  if (parsed === null) {
    return undefined;
  }

  if (typeof parsed !== "object") {
    return undefined;
  }

  if ("value" in parsed) {
    return parsed.value;
  }

  return undefined;
};

class WorkflowDefinition<TInput, TResult> {
  private options: WorkflowOptions<TInput, TResult>;
  private lockTTL: number;
  private retries: number;
  private retryBaseDelay: number;
  private retryMultiplier: number;
  private retryMaxDelay: number;
  private concurrency: number;
  private partitionConcurrency: number;
  private pollInterval: number;
  private recoveryIntervalMs: number;
  private running = true;
  private activeWorkers = 0;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;

  public constructor(options: WorkflowOptions<TInput, TResult>) {
    this.options = options;
    this.lockTTL = options.lockTTL ?? DEFAULT_LOCK_TTL;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryBaseDelay =
      options.retryBackoff?.baseDelay ?? DEFAULT_RETRY_BASE_DELAY;
    this.retryMultiplier =
      options.retryBackoff?.multiplier ?? DEFAULT_RETRY_MULTIPLIER;
    this.retryMaxDelay =
      options.retryBackoff?.maxDelay ?? DEFAULT_RETRY_MAX_DELAY;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.partitionConcurrency =
      options.partitionConcurrency ?? this.concurrency;
    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.recoveryIntervalMs =
      options.recoveryIntervalMs ?? DEFAULT_RECOVERY_INTERVAL_MS;

    assert.ok(
      Number.isFinite(this.retries) && this.retries >= 0,
      "Invalid retries: must be a non-negative finite number",
    );
    assert.ok(
      Number.isFinite(this.retryBaseDelay) && this.retryBaseDelay > 0,
      "Invalid retryBackoff.baseDelay: must be a positive finite number",
    );
    assert.ok(
      Number.isFinite(this.retryMultiplier) && this.retryMultiplier > 0,
      "Invalid retryBackoff.multiplier: must be a positive finite number",
    );
    assert.ok(
      Number.isFinite(this.retryMaxDelay) && this.retryMaxDelay > 0,
      "Invalid retryBackoff.maxDelay: must be a positive finite number",
    );
    assert.ok(
      Number.isFinite(this.concurrency) && this.concurrency > 0,
      "Invalid concurrency: must be a positive finite number",
    );
    assert.ok(
      Number.isFinite(this.partitionConcurrency) &&
        this.partitionConcurrency > 0,
      "Invalid partitionConcurrency: must be a positive finite number",
    );
    assert.ok(
      Number.isFinite(this.pollInterval) && this.pollInterval >= 0,
      "Invalid pollInterval: must be a non-negative finite number",
    );
    assert.ok(
      Number.isFinite(this.recoveryIntervalMs) && this.recoveryIntervalMs >= 0,
      "Invalid recoveryIntervalMs: must be a non-negative finite number",
    );

    this.startWorkers();
    this.startRecovery();
  }

  private runHook<T>(hook: () => T | Promise<T>) {
    return mightThrow(Promise.resolve().then(() => hook()));
  }

  private computeBackoffDelay(attempt: number) {
    return Math.min(
      this.retryBaseDelay * this.retryMultiplier ** (attempt - 1),
      this.retryMaxDelay,
    );
  }

  public async start(input: TInput, options?: WorkflowStartOptions) {
    const executionId = options?.executionId ?? crypto.randomUUID();

    await this.createExecution(executionId, input, options);

    await this.enqueueExecution(executionId);

    return { executionId, status: "pending" } satisfies WorkflowStartResult;
  }

  public async resume(executionId: string) {
    const execution = await this.get(executionId);

    if (execution.status === "completed") {
      return {
        executionId,
        status: execution.status,
      } satisfies WorkflowStartResult;
    }

    if (execution.status === "cancelled") {
      return {
        executionId,
        status: execution.status,
      } satisfies WorkflowStartResult;
    }

    if (execution.status === "failed") {
      const timestamp = now();

      await this.setMetaFields(executionId, {
        status: "pending",
        updatedAt: String(timestamp),
        error: "",
        failedAt: "",
      });
    }

    await this.enqueueExecution(executionId);

    return { executionId, status: "pending" } satisfies WorkflowStartResult;
  }

  public async stop() {
    this.running = false;
    this.stopRecovery();

    const deadline = now() + this.lockTTL;

    while (this.activeWorkers > 0) {
      if (now() >= deadline) {
        return;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, SHUTDOWN_POLL_INTERVAL),
      );
    }
  }

  public async get(executionId: string) {
    const status = await this.getMeta(executionId, "status");

    if (!status) {
      throw new NotFoundError(`Workflow execution ${executionId} not found`);
    }

    const storedName = await this.getMeta(executionId, "name");

    if (storedName !== this.options.name) {
      throw new NotFoundError(`Workflow execution ${executionId} not found`);
    }

    const normalizedStatus = this.normalizeStatus(status);

    if (!normalizedStatus) {
      throw new StateError(
        `Workflow execution ${executionId} has invalid status ${status}`,
      );
    }

    const input = await this.readInput(executionId);
    const result = await this.readResult(executionId);
    const steps = await this.readStepSnapshots(executionId);
    const createdAt = await this.readNumberMeta(executionId, "createdAt");
    const updatedAt = await this.readNumberMeta(executionId, "updatedAt");
    const errorMessage = await this.getMeta(executionId, "error");
    const completedAt = await this.readNumberMeta(executionId, "completedAt");
    const failedAt = await this.readNumberMeta(executionId, "failedAt");
    const cancelledAt = await this.readNumberMeta(executionId, "cancelledAt");

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

    const data: WorkflowExecution<TInput, TResult> = {
      id: executionId,
      name: this.options.name,
      status: normalizedStatus,
      input,
      result,
      error: errorMessage,
      createdAt,
      updatedAt,
      completedAt,
      failedAt,
      cancelledAt,
      steps,
    };

    return data;
  }

  public async cancel(executionId: string) {
    const execution = await this.get(executionId);

    if (execution.status === "completed") {
      throw new StateError(
        `Workflow execution ${executionId} is already completed`,
      );
    }

    const timestamp = now();

    await this.setMetaFields(executionId, {
      status: "cancelled",
      updatedAt: String(timestamp),
      cancelledAt: String(timestamp),
      error: "",
      failedAt: "",
    });

    const response: WorkflowCancelResult = {
      executionId,
      createdAt: execution.createdAt,
      cancelledAt: timestamp,
      updatedAt: timestamp,
      status: "cancelled",
    };

    return response;
  }

  private executionKey(executionId: string) {
    return executionKey(executionId);
  }

  private metaKey(executionId: string) {
    return metaKeyFor(executionId);
  }

  private stepsKey(executionId: string) {
    return `${this.executionKey(executionId)}:steps`;
  }

  private lockKey(executionId: string) {
    return lockKeyFor(executionId);
  }

  private partitionKeyPrefix(partitionKey: string) {
    return `workflow:${this.options.name}:partition:${partitionKey}`;
  }

  private partitionSlotKey(partitionKey: string, slot: number) {
    return `${this.partitionKeyPrefix(partitionKey)}:${slot}`;
  }

  private resolvePartitionKey(
    input: TInput,
    startOptions?: WorkflowStartOptions,
  ) {
    if (startOptions?.partitionKey !== undefined) {
      if (typeof startOptions.partitionKey !== "string") {
        throw new StateError(
          "Invalid partitionKey: must be a non-empty string",
        );
      }

      if (startOptions.partitionKey.length === 0) {
        throw new StateError(
          "Invalid partitionKey: must be a non-empty string",
        );
      }

      return startOptions.partitionKey;
    }

    if (!this.options.partitionBy) {
      return "";
    }

    const key = this.options.partitionBy(input);

    if (typeof key !== "string") {
      throw new StateError(
        "Invalid partitionBy result: must be a non-empty string",
      );
    }

    if (key.length === 0) {
      throw new StateError(
        "Invalid partitionBy result: must be a non-empty string",
      );
    }

    return key;
  }

  private async createExecution(
    executionId: string,
    input: TInput,
    startOptions?: WorkflowStartOptions,
  ) {
    const serializedInput = this.serializeInput(input);

    const timestamp = now();

    const metadata: WorkflowMeta = {
      name: this.options.name,
      status: "pending",
      input: serializedInput,
      result: "",
      error: "",
      createdAt: String(timestamp),
      updatedAt: String(timestamp),
      completedAt: "",
      failedAt: "",
      cancelledAt: "",
      steps: "[]",
      partitionKey: this.resolvePartitionKey(input, startOptions),
    };

    const script =
      "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end return redis.call('HSET', KEYS[1], unpack(ARGV))";

    const argv: string[] = [];

    for (const [field, value] of Object.entries(metadata)) {
      argv.push(field, value);
    }

    const [writeError, created] = await mightThrow(
      this.options.redis.send("EVAL", [
        script,
        "1",
        this.metaKey(executionId),
        ...argv,
      ]),
    );

    if (writeError) {
      throw new WorkflowError(
        `Unable to persist metadata for execution ${executionId}`,
      );
    }

    if (created === 0) {
      throw new StateError(`Workflow execution ${executionId} already exists`);
    }
  }

  private jobsKey() {
    return `workflow:${this.options.name}:jobs`;
  }

  private processingKey() {
    return `workflow:${this.options.name}:processing`;
  }

  private waitForPollInterval() {
    return new Promise((resolve) => setTimeout(resolve, this.pollInterval));
  }

  private async enqueueExecution(executionId: string) {
    if (!this.running) {
      throw new StateError(`Workflow ${this.options.name} has been stopped`);
    }

    const [enqueueError] = await mightThrow(
      this.options.redis.lpush(this.jobsKey(), executionId),
    );

    if (enqueueError) {
      throw new WorkflowError(`Unable to enqueue execution ${executionId}`);
    }
  }

  private async claimExecution() {
    const [claimError, executionId] = await mightThrow(
      this.options.redis.rpoplpush(this.jobsKey(), this.processingKey()),
    );

    if (claimError) {
      throw new WorkflowError(
        `Unable to claim execution for workflow ${this.options.name}`,
      );
    }

    if (executionId === null || executionId === undefined) {
      return null;
    }

    if (typeof executionId !== "string") {
      return null;
    }

    if (executionId.length === 0) {
      return null;
    }

    return executionId;
  }

  private async ackClaim(executionId: string) {
    await mightThrow(
      this.options.redis.lrem(this.processingKey(), 1, executionId),
    );
  }

  private startWorkers() {
    for (let i = 0; i < this.concurrency; i++) {
      this.processJobs();
    }
  }

  private startRecovery() {
    if (this.recoveryIntervalMs === 0) {
      return;
    }

    this.recoveryTimer = setInterval(() => {
      void mightThrow(
        recoverOrphanedWorkflows(this.options.redis, {
          name: this.options.name,
        }),
      );
    }, this.recoveryIntervalMs);
  }

  private stopRecovery() {
    if (this.recoveryTimer === null) {
      return;
    }

    clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private async processJobs() {
    while (this.running) {
      const [claimError, executionId] = await mightThrow(this.claimExecution());

      if (claimError) {
        await this.waitForPollInterval();
        continue;
      }

      if (!executionId) {
        await this.waitForPollInterval();
        continue;
      }

      if (!this.running) {
        await this.ackClaim(executionId);
        await mightThrow(this.options.redis.lpush(this.jobsKey(), executionId));
        break;
      }

      this.activeWorkers++;

      try {
        await mightThrow(this.runQueuedExecution(executionId));
      } finally {
        await this.ackClaim(executionId);
        this.activeWorkers--;
      }
    }
  }

  private async runQueuedExecution(executionId: string) {
    const [loadError, execution] = await mightThrow(this.get(executionId));

    if (loadError) {
      return;
    }

    if (!execution) {
      return;
    }

    if (execution.status === "completed") {
      return;
    }

    if (execution.status === "cancelled") {
      return;
    }

    await this.executeInBackground(executionId, execution.input);
  }

  private async executeInBackground(executionId: string, input: TInput) {
    const [executionError] = await mightThrow(this.execute(executionId, input));

    if (!executionError) {
      return;
    }

    if (
      executionError instanceof LockError &&
      executionError.message.includes("already running")
    ) {
      return;
    }

    if (executionError instanceof PartitionError) {
      if (!this.running) {
        return;
      }

      const [enqueueError] = await mightThrow(
        this.enqueueExecution(executionId),
      );

      if (enqueueError) {
        return;
      }

      await this.waitForPollInterval();
      return;
    }

    const [recordError] = await mightThrow(
      this.recordBackgroundFailure(executionId, executionError),
    );

    if (recordError) {
      console.error("Unable to record background workflow failure", {
        executionId,
        error: recordError,
      });
    }
  }

  private async recordBackgroundFailure(executionId: string, error: Error) {
    const status = await this.getMeta(executionId, "status");

    if (status !== "pending") {
      return;
    }

    const failedAt = now();

    await this.setMetaFields(executionId, {
      status: "failed",
      error: error.message,
      updatedAt: String(failedAt),
      failedAt: String(failedAt),
    });
  }

  private async execute(executionId: string, input: TInput) {
    const token = crypto.randomUUID();
    const partitionKey = await this.getMeta(executionId, "partitionKey");

    await this.acquireLock(executionId, token);

    let partitionSlot: number | null = null;

    try {
      if (partitionKey) {
        partitionSlot = await this.acquirePartition(partitionKey, token);
      }

      return await this.runExecute(
        executionId,
        input,
        token,
        partitionKey,
        partitionSlot,
      );
    } finally {
      if (partitionKey !== null && partitionSlot !== null) {
        await this.releasePartition(partitionKey, token, partitionSlot);
      }

      await this.releaseLock(executionId, token);
    }
  }

  private async runExecute(
    executionId: string,
    input: TInput,
    token: string,
    partitionKey: string | null,
    partitionSlot: number | null,
  ) {
    const currentStatus = await this.getMeta(executionId, "status");

    if (currentStatus === "cancelled") {
      throw new StateError(`Workflow execution ${executionId} was cancelled`);
    }

    const timestamp = now();

    await this.setMetaFields(executionId, {
      status: "running",
      updatedAt: String(timestamp),
    });

    const controller = new AbortController();

    const renewInterval = Math.floor(this.lockTTL / 3);

    let lockLost = false;
    let partitionLost = false;

    const renewTimer = setInterval(async () => {
      const [renewError] = await mightThrow(
        this.extendLock(executionId, token),
      );

      if (renewError) {
        lockLost = true;
        controller.abort();
        clearInterval(renewTimer);
        return;
      }

      if (partitionKey === null) {
        return;
      }

      if (partitionSlot === null) {
        return;
      }

      const [partitionRenewError] = await mightThrow(
        this.extendPartition(partitionKey, token, partitionSlot),
      );

      if (partitionRenewError) {
        partitionLost = true;
        controller.abort();
        clearInterval(renewTimer);
      }
    }, renewInterval);

    if (this.options.hooks?.onStart) {
      await this.runHook(() =>
        this.options.hooks?.onStart?.({
          executionId,
          input,
        }),
      );
    }

    const step = async <TStep>(
      name: string,
      handler: StepHandler<TInput, TStep>,
    ) => {
      await this.throwIfCancelled(executionId, () => {
        controller.abort();
      });

      const cachedStep = await this.readStepOutput<TStep>(executionId, name);

      if (cachedStep.found) {
        return cachedStep.value as TStep;
      }

      return this.runStepWithRetries(
        executionId,
        input,
        name,
        handler,
        controller.signal,
        () => {
          controller.abort();
        },
      );
    };

    const handlerOutcome = await mightThrow(
      Promise.resolve(
        this.options.handler({
          input,
          executionId,
          signal: controller.signal,
          step,
        }),
      ),
    );

    clearInterval(renewTimer);

    if (partitionLost) {
      await this.releaseLock(executionId, token);

      throw new PartitionError(
        `Partition ownership lost for ${partitionKey} on workflow ${this.options.name}`,
      );
    }

    if (lockLost) {
      await this.releaseLock(executionId, token);
      throw new LockError(`Lock expired during execution ${executionId}`);
    }

    const cancelled = await this.isCancelled(executionId);

    if (cancelled) {
      const cancelledAt = now();

      await this.setMetaFields(executionId, {
        status: "cancelled",
        updatedAt: String(cancelledAt),
        cancelledAt: String(cancelledAt),
      });

      if (this.options.hooks?.onCancel) {
        await this.runHook(() =>
          this.options.hooks?.onCancel?.({
            executionId,
            input,
          }),
        );
      }

      await this.releaseLock(executionId, token);

      return { executionId, status: "cancelled" } satisfies WorkflowStartResult;
    }

    const [handlerError, result] = handlerOutcome;

    if (handlerError) {
      const failedAt = now();

      await this.setMetaFields(executionId, {
        status: "failed",
        error: handlerError.message,
        updatedAt: String(failedAt),
        failedAt: String(failedAt),
      });

      await this.releaseLock(executionId, token);

      throw new ExecutionError(
        `Workflow execution ${executionId} failed: ${handlerError.message}`,
      );
    }

    const [serializeResultError, serializedResult] = mightThrowSync(() =>
      this.serializeResult(result),
    );

    if (serializeResultError) {
      const failedAt = now();

      await this.setMetaFields(executionId, {
        status: "failed",
        error: serializeResultError.message,
        updatedAt: String(failedAt),
        failedAt: String(failedAt),
      });

      await this.releaseLock(executionId, token);

      throw new SerializationError(
        `Unable to serialize workflow result for ${executionId}`,
      );
    }

    const completedAt = now();

    await this.setMetaFields(executionId, {
      result: serializedResult,
      status: "completed",
      error: "",
      failedAt: "",
      updatedAt: String(completedAt),
      completedAt: String(completedAt),
    });

    if (this.options.hooks?.onComplete) {
      await this.runHook(() =>
        this.options.hooks?.onComplete?.({
          executionId,
          input,
          result,
        }),
      );
    }

    await this.releaseLock(executionId, token);

    return { executionId, status: "completed" } satisfies WorkflowStartResult;
  }

  private async throwIfCancelled(executionId: string, abort: () => void) {
    const cancelled = await this.isCancelled(executionId);

    if (cancelled) {
      abort();
      throw new CancelledError(
        `Workflow execution ${executionId} was cancelled`,
      );
    }
  }

  private async runStepWithRetries<TStep>(
    executionId: string,
    input: TInput,
    stepName: string,
    handler: StepHandler<TInput, TStep>,
    signal: AbortSignal,
    abort: () => void,
  ) {
    let attempt = 1;

    const errorHistory: WorkflowStepErrorRecord[] = [];

    const fail = (message: string): never => {
      throw new StepFailedError(message);
    };

    while (true) {
      await this.throwIfCancelled(executionId, abort);

      await this.writeStepStarted(executionId, stepName, attempt);

      const stepOutcome = await mightThrow(
        Promise.resolve(
          handler({
            input,
            signal,
            fail,
          }),
        ),
      );

      const [stepError, output] = stepOutcome;

      if (!stepError) {
        await this.writeStepOutput(executionId, stepName, output);

        return output;
      }

      const errorMsg = stepError.message;

      errorHistory.push({
        attempt,
        error: errorMsg,
        timestamp: now(),
      });

      const shouldRetry =
        !(stepError instanceof StepFailedError) && attempt <= this.retries;

      if (shouldRetry) {
        const nextRetryDelayMs = this.computeBackoffDelay(attempt);

        if (this.options.hooks?.onRetry) {
          await this.runHook(() =>
            this.options.hooks?.onRetry?.({
              executionId,
              input,
              stepName,
              error: errorMsg,
              attempt,
              nextRetryDelayMs,
              retriesRemaining: this.retries - attempt,
            }),
          );
        }

        const [delayError] = await mightThrow(
          delay(nextRetryDelayMs, signal, () => this.isCancelled(executionId)),
        );

        if (delayError) {
          throw delayError;
        }

        attempt++;

        continue;
      }

      if (this.options.hooks?.onError) {
        await this.runHook(() =>
          this.options.hooks?.onError?.({
            executionId,
            input,
            stepName,
            error: errorMsg,
            totalAttempts: attempt,
            errorHistory,
          }),
        );
      }

      throw stepError;
    }
  }

  private async acquireLock(executionId: string, token: string) {
    const [lockError, lockResult] = await mightThrow(
      this.options.redis.set(
        this.lockKey(executionId),
        token,
        "PX",
        String(this.lockTTL),
        "NX",
      ),
    );

    if (lockError) {
      throw new LockError(
        `Unable to acquire lock for execution ${executionId}`,
      );
    }

    if (lockResult !== "OK") {
      throw new LockError(
        `Workflow execution ${executionId} is already running`,
      );
    }
  }

  private async releaseLock(executionId: string, token: string) {
    const script =
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

    await mightThrow(
      this.options.redis.send("EVAL", [
        script,
        "1",
        this.lockKey(executionId),
        token,
      ]),
    );
  }

  private async extendLock(executionId: string, token: string) {
    const script =
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";

    const [evalError, extendResult] = await mightThrow(
      this.options.redis.send("EVAL", [
        script,
        "1",
        this.lockKey(executionId),
        token,
        String(this.lockTTL),
      ]),
    );

    if (evalError) {
      throw new LockError(`Unable to extend lock for execution ${executionId}`);
    }

    if (extendResult === 0) {
      throw new LockError(`Lock ownership lost for execution ${executionId}`);
    }
  }

  private async acquirePartition(partitionKey: string, token: string) {
    for (let slot = 0; slot < this.partitionConcurrency; slot++) {
      const [setError, setResult] = await mightThrow(
        this.options.redis.set(
          this.partitionSlotKey(partitionKey, slot),
          token,
          "PX",
          String(this.lockTTL),
          "NX",
        ),
      );

      if (setError) {
        throw new PartitionError(
          `Unable to acquire partition ${partitionKey} for workflow ${this.options.name}`,
        );
      }

      if (setResult === "OK") {
        return slot;
      }
    }

    throw new PartitionError(
      `Partition ${partitionKey} is at capacity for workflow ${this.options.name}`,
    );
  }

  private async extendPartition(
    partitionKey: string,
    token: string,
    slot: number,
  ) {
    const script =
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";

    const [evalError, extendResult] = await mightThrow(
      this.options.redis.send("EVAL", [
        script,
        "1",
        this.partitionSlotKey(partitionKey, slot),
        token,
        String(this.lockTTL),
      ]),
    );

    if (evalError) {
      throw new PartitionError(
        `Unable to extend partition ${partitionKey} for workflow ${this.options.name}`,
      );
    }

    if (extendResult === 0) {
      throw new PartitionError(
        `Partition ownership lost for ${partitionKey} on workflow ${this.options.name}`,
      );
    }
  }

  private async releasePartition(
    partitionKey: string,
    token: string,
    slot: number,
  ) {
    const script =
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

    await mightThrow(
      this.options.redis.send("EVAL", [
        script,
        "1",
        this.partitionSlotKey(partitionKey, slot),
        token,
      ]),
    );
  }

  private async isCancelled(executionId: string) {
    const status = await this.getMeta(executionId, "status");

    return status === "cancelled";
  }

  private async setMeta(
    executionId: string,
    field: WorkflowMetaField,
    value: string,
  ) {
    await this.setMetaFields(executionId, { [field]: value });
  }

  private async setMetaFields(
    executionId: string,
    fields: Partial<WorkflowMeta>,
  ) {
    const [writeError] = await mightThrow(
      this.options.redis.hset(this.metaKey(executionId), fields),
    );

    if (writeError) {
      const fieldNames = Object.keys(fields).join(", ");

      throw new WorkflowError(
        `Unable to persist ${fieldNames} for execution ${executionId}`,
      );
    }
  }

  private async getMeta(executionId: string, field: WorkflowMetaField) {
    const [readError, value] = await mightThrow(
      this.options.redis.hget(this.metaKey(executionId), field),
    );

    if (readError) {
      throw new WorkflowError(
        `Unable to read ${field} for execution ${executionId}`,
      );
    }

    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value !== "string") {
      throw new StateError(
        `Invalid ${field} value for execution ${executionId}`,
      );
    }

    if (value.length === 0) {
      return null;
    }

    return value;
  }

  private async readNumberMeta(executionId: string, field: WorkflowMetaField) {
    const value = await this.getMeta(executionId, field);

    if (!value) {
      return null;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      throw new StateError(
        `Invalid ${field} value for execution ${executionId}`,
      );
    }

    return parsed;
  }

  private runSerializer<T>(
    value: T,
    serializer: (v: T) => string,
    label: string,
  ) {
    const [serializeError, serialized] = mightThrowSync(() =>
      serializer(value),
    );

    if (serializeError) {
      throw new SerializationError(
        `Unable to serialize ${label}: ${serializeError.message}`,
      );
    }

    if (typeof serialized !== "string") {
      throw new SerializationError(`${label} serializer must return a string`);
    }

    return serialized;
  }

  private runDeserializer<T>(
    raw: string,
    deserializer: (v: string) => T,
    label: string,
  ) {
    const result = mightThrowSync(() => deserializer(raw));

    if (result[0]) {
      throw new SerializationError(
        `Unable to deserialize ${label}: ${result[0].message}`,
      );
    }

    return result[1];
  }

  private serializeInput(input: TInput) {
    return this.runSerializer(
      input,
      this.options.serializeInput ?? envelopeSerialize,
      "workflow input",
    );
  }

  private deserializeInput(raw: string) {
    const deserializer =
      this.options.deserializeInput ??
      ((value: string) => envelopeDeserialize(value) as TInput);

    return this.runDeserializer(raw, deserializer, "workflow input");
  }

  private serializeResult(result: TResult | null) {
    if (result === null) {
      return envelopeSerialize(null);
    }

    return this.runSerializer(
      result,
      this.options.serializeResult ?? envelopeSerialize,
      "workflow result",
    );
  }

  private deserializeResult(raw: string) {
    const deserializer =
      this.options.deserializeResult ??
      ((value: string) => envelopeDeserialize(value) as TResult);

    return this.runDeserializer(raw, deserializer, "workflow result");
  }

  private serializeStepOutput(output: unknown) {
    return this.runSerializer(
      output,
      this.options.serializeStepOutput ?? envelopeSerialize,
      "step output",
    );
  }

  private deserializeStepOutput(raw: string) {
    const deserializer =
      this.options.deserializeStepOutput ??
      ((value: string) => envelopeDeserialize(value));

    return this.runDeserializer(raw, deserializer, "step output");
  }

  private async readInput(executionId: string) {
    const raw = await this.getMeta(executionId, "input");

    if (!raw) {
      throw new StateError(`Workflow execution ${executionId} input not found`);
    }

    return this.deserializeInput(raw);
  }

  private async readResult(executionId: string) {
    const raw = await this.getMeta(executionId, "result");

    if (!raw) {
      return null;
    }

    return this.deserializeResult(raw);
  }

  private async writeStepStarted(
    executionId: string,
    stepName: string,
    attempt: number,
  ) {
    const payload = {
      startedAt: now(),
      attempt,
    };

    const [payloadError, payloadRaw] = mightThrowSync(() =>
      JSON.stringify(payload),
    );

    if (payloadError || typeof payloadRaw !== "string") {
      throw new SerializationError(
        `Unable to persist step ${stepName} start marker`,
      );
    }

    const [writeError] = await mightThrow(
      this.options.redis.hset(this.stepsKey(executionId), stepName, payloadRaw),
    );

    if (writeError) {
      throw new WorkflowError(
        `Unable to persist step ${stepName} start for execution ${executionId}`,
      );
    }
  }

  private async writeStepOutput(
    executionId: string,
    stepName: string,
    output: unknown,
  ) {
    const serializedOutput = this.serializeStepOutput(output);

    const payload = {
      output: serializedOutput,
      completedAt: now(),
    };

    const [payloadError, payloadRaw] = mightThrowSync(() =>
      JSON.stringify(payload),
    );

    if (payloadError || typeof payloadRaw !== "string") {
      throw new SerializationError(`Unable to persist step ${stepName} output`);
    }

    const [writeError] = await mightThrow(
      this.options.redis.hset(this.stepsKey(executionId), stepName, payloadRaw),
    );

    if (writeError) {
      throw new WorkflowError(
        `Unable to persist step ${stepName} for execution ${executionId}`,
      );
    }

    const stepNames = await this.readStepNames(executionId);

    if (!stepNames.includes(stepName)) {
      const nextStepNames = [...stepNames, stepName];

      const [serializeStepsError, serializedSteps] = mightThrowSync(() =>
        JSON.stringify(nextStepNames),
      );

      if (serializeStepsError || typeof serializedSteps !== "string") {
        throw new SerializationError(
          `Unable to persist step history for execution ${executionId}`,
        );
      }

      await this.setMetaFields(executionId, {
        steps: serializedSteps,
        updatedAt: String(now()),
      });

      return;
    }

    await this.setMeta(executionId, "updatedAt", String(now()));
  }

  private async readStepOutput<TStep>(executionId: string, stepName: string) {
    const [readError, payloadRaw] = await mightThrow(
      this.options.redis.hget(this.stepsKey(executionId), stepName),
    );

    if (readError) {
      throw new WorkflowError(
        `Unable to read step ${stepName} for execution ${executionId}`,
      );
    }

    if (!payloadRaw) {
      return { found: false, value: null };
    }

    if (typeof payloadRaw !== "string") {
      throw new StateError(
        `Invalid step payload for ${stepName} in execution ${executionId}`,
      );
    }

    const [parseError, parsed] = mightThrowSync(() => JSON.parse(payloadRaw));

    if (parseError || parsed === null || typeof parsed !== "object") {
      throw new StateError(
        `Invalid step payload for ${stepName} in execution ${executionId}`,
      );
    }

    if (typeof parsed.output !== "string") {
      return { found: false, value: null };
    }

    const outputRaw = parsed.output;

    const value = this.deserializeStepOutput(outputRaw);

    return { found: true, value: value as TStep };
  }

  private async readStepNames(executionId: string) {
    const stepsRaw = await this.getMeta(executionId, "steps");

    if (!stepsRaw) {
      return [] as string[];
    }

    const [parseError, values] = mightThrowSync(() => JSON.parse(stepsRaw));

    if (parseError || !Array.isArray(values)) {
      throw new StateError(`Invalid step index for execution ${executionId}`);
    }

    const stepNames: string[] = [];

    for (const value of values) {
      if (typeof value === "string") {
        stepNames.push(value);
      }
    }

    return stepNames;
  }

  private async readStepSnapshots(executionId: string) {
    const stepNames = await this.readStepNames(executionId);

    const steps: StepSnapshot[] = [];

    for (const stepName of stepNames) {
      const [readError, payloadRaw] = await mightThrow(
        this.options.redis.hget(this.stepsKey(executionId), stepName),
      );

      if (readError) {
        throw new WorkflowError(
          `Unable to read step ${stepName} for execution ${executionId}`,
        );
      }

      if (!payloadRaw) {
        continue;
      }

      if (typeof payloadRaw !== "string") {
        throw new StateError(
          `Invalid step payload for ${stepName} in execution ${executionId}`,
        );
      }

      const [parseError, parsed] = mightThrowSync(() => JSON.parse(payloadRaw));

      if (parseError || parsed === null || typeof parsed !== "object") {
        throw new StateError(
          `Invalid step payload for ${stepName} in execution ${executionId}`,
        );
      }

      if (typeof parsed.output !== "string") {
        continue;
      }

      if (typeof parsed.completedAt !== "number") {
        throw new StateError(
          `Invalid step payload for ${stepName} in execution ${executionId}`,
        );
      }

      steps.push({
        name: stepName,
        completedAt: parsed.completedAt,
      });
    }

    return steps;
  }

  private normalizeStatus(value: string) {
    return normalizeStatusValue(value);
  }
}

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

export {
  CancelledError,
  ExecutionError,
  LockError,
  NotFoundError,
  PartitionError,
  SerializationError,
  StateError,
  StepFailedError,
  WorkflowError,
} from "./errors.js";
export type {
  StepContext,
  StepHandler,
  Workflow,
  WorkflowExecution,
  WorkflowHandlerContext,
  WorkflowHooks,
  WorkflowListItem,
  WorkflowListOptions,
  WorkflowMeta,
  WorkflowMetaField,
  WorkflowOptions,
  WorkflowRecoverOptions,
  WorkflowRetryBackoff,
  WorkflowStartOptions,
  WorkflowStartResult,
  WorkflowStatus,
  WorkflowStepErrorContext,
  WorkflowStepErrorRecord,
  WorkflowStepRetryContext,
} from "./types.js";

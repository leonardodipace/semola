import { mightThrow, mightThrowSync } from "../errors/index.js";
import {
  CancelledError,
  ExecutionError,
  LockError,
  NotFoundError,
  SerializationError,
  StateError,
  WorkflowError,
} from "./errors.js";
import type {
  StepSnapshot,
  Workflow,
  WorkflowCancelResult,
  WorkflowExecution,
  WorkflowMeta,
  WorkflowMetaField,
  WorkflowOptions,
  WorkflowStartOptions,
  WorkflowStartResult,
  WorkflowStatus,
} from "./types.js";

const DEFAULT_LOCK_TTL = 5 * 60 * 1000;

const now = () => Date.now();

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

const knownStatuses: WorkflowStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];

class WorkflowDefinition<TInput, TResult> {
  private options: WorkflowOptions<TInput, TResult>;
  private lockTTL: number;

  public constructor(options: WorkflowOptions<TInput, TResult>) {
    this.options = options;
    this.lockTTL = options.lockTTL ?? DEFAULT_LOCK_TTL;
  }

  public async start(input: TInput, options?: WorkflowStartOptions) {
    const executionId = options?.executionId ?? crypto.randomUUID();

    await this.createExecution(executionId, input);

    return this.execute(executionId, input);
  }

  public async run(input: TInput, options?: WorkflowStartOptions) {
    const startData = await this.start(input, options);

    if (startData.status === "cancelled") {
      throw new CancelledError(
        `Workflow execution ${startData.executionId} was cancelled`,
      );
    }

    const execution = await this.get(startData.executionId);

    return execution.result;
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

    return this.execute(executionId, execution.input);
  }

  public async get(executionId: string) {
    const status = await this.getMeta(executionId, "status");

    if (!status) {
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

    await this.setMeta(executionId, "status", "cancelled");
    await this.setMeta(executionId, "updatedAt", String(timestamp));
    await this.setMeta(executionId, "cancelledAt", String(timestamp));
    await this.setMeta(executionId, "error", "");
    await this.setMeta(executionId, "failedAt", "");

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
    return `workflow:${this.options.name}:execution:${executionId}`;
  }

  private metaKey(executionId: string) {
    return `${this.executionKey(executionId)}:meta`;
  }

  private stepsKey(executionId: string) {
    return `${this.executionKey(executionId)}:steps`;
  }

  private lockKey(executionId: string) {
    return `${this.executionKey(executionId)}:lock`;
  }

  private async createExecution(executionId: string, input: TInput) {
    const serializedInput = this.serializeInput(input);

    const timestamp = now();

    const existingStatus = await this.getMeta(executionId, "status");

    if (existingStatus) {
      throw new StateError(`Workflow execution ${executionId} already exists`);
    }

    const metadata: WorkflowMeta = {
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
    };

    const [writeError] = await mightThrow(
      this.options.redis.hset(this.metaKey(executionId), metadata),
    );

    if (writeError) {
      throw new WorkflowError(
        `Unable to persist metadata for execution ${executionId}`,
      );
    }
  }

  private async execute(executionId: string, input: TInput) {
    const token = crypto.randomUUID();

    await this.acquireLock(executionId, token);

    const currentStatus = await this.getMeta(executionId, "status");

    if (currentStatus === "cancelled") {
      await this.releaseLock(executionId, token);
      throw new StateError(`Workflow execution ${executionId} was cancelled`);
    }

    const timestamp = now();

    await this.setMeta(executionId, "status", "running");
    await this.setMeta(executionId, "updatedAt", String(timestamp));

    const controller = new AbortController();

    const renewInterval = Math.floor(this.lockTTL / 3);

    let lockLost = false;

    const renewTimer = setInterval(async () => {
      const [renewError] = await mightThrow(
        this.extendLock(executionId, token),
      );

      if (renewError) {
        lockLost = true;
        controller.abort();
        clearInterval(renewTimer);
      }
    }, renewInterval);

    const step = async <TStep>(
      name: string,
      handler: (
        inputValue: TInput,
        signal: AbortSignal,
      ) => TStep | Promise<TStep>,
    ) => {
      const cancelled = await this.isCancelled(executionId);

      if (cancelled) {
        controller.abort();
        throw new CancelledError(
          `Workflow execution ${executionId} was cancelled`,
        );
      }

      const cachedStep = await this.readStepOutput<TStep>(executionId, name);

      if (cachedStep.found) {
        return cachedStep.value as TStep;
      }

      const [stepError, output] = await mightThrow(
        Promise.resolve(handler(input, controller.signal)),
      );

      if (stepError) {
        throw stepError;
      }

      await this.writeStepOutput(executionId, name, output);

      return output as TStep;
    };

    const [handlerError, result] = await mightThrow(
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

    if (lockLost) {
      await this.releaseLock(executionId, token);
      throw new LockError(`Lock expired during execution ${executionId}`);
    }

    const cancelled = await this.isCancelled(executionId);

    if (cancelled) {
      const cancelledAt = now();

      await this.setMeta(executionId, "status", "cancelled");
      await this.setMeta(executionId, "updatedAt", String(cancelledAt));
      await this.setMeta(executionId, "cancelledAt", String(cancelledAt));

      await this.releaseLock(executionId, token);

      return { executionId, status: "cancelled" } satisfies WorkflowStartResult;
    }

    if (handlerError) {
      const failedAt = now();

      await this.setMeta(executionId, "status", "failed");
      await this.setMeta(executionId, "error", toErrorMessage(handlerError));
      await this.setMeta(executionId, "updatedAt", String(failedAt));
      await this.setMeta(executionId, "failedAt", String(failedAt));

      await this.releaseLock(executionId, token);

      throw new ExecutionError(
        `Workflow execution ${executionId} failed: ${toErrorMessage(handlerError)}`,
      );
    }

    const [serializeResultError, serializedResult] = mightThrowSync(() =>
      this.serializeResult(result),
    );

    if (serializeResultError) {
      const failedAt = now();

      await this.setMeta(executionId, "status", "failed");
      await this.setMeta(
        executionId,
        "error",
        toErrorMessage(serializeResultError),
      );
      await this.setMeta(executionId, "updatedAt", String(failedAt));
      await this.setMeta(executionId, "failedAt", String(failedAt));

      await this.releaseLock(executionId, token);

      throw new SerializationError(
        `Unable to serialize workflow result for ${executionId}`,
      );
    }

    const completedAt = now();

    await this.setMeta(executionId, "result", serializedResult);
    await this.setMeta(executionId, "status", "completed");
    await this.setMeta(executionId, "error", "");
    await this.setMeta(executionId, "failedAt", "");
    await this.setMeta(executionId, "updatedAt", String(completedAt));
    await this.setMeta(executionId, "completedAt", String(completedAt));

    await this.releaseLock(executionId, token);

    return { executionId, status: "completed" } satisfies WorkflowStartResult;
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

  private async isCancelled(executionId: string) {
    const status = await this.getMeta(executionId, "status");

    return status === "cancelled";
  }

  private async setMeta(
    executionId: string,
    field: WorkflowMetaField,
    value: string,
  ) {
    const [writeError] = await mightThrow(
      this.options.redis.hset(this.metaKey(executionId), field, value),
    );

    if (writeError) {
      throw new WorkflowError(
        `Unable to persist ${field} for execution ${executionId}`,
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
        `Unable to serialize ${label}: ${toErrorMessage(serializeError)}`,
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
        `Unable to deserialize ${label}: ${toErrorMessage(result[0])}`,
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

      await this.setMeta(executionId, "steps", serializedSteps);
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
      throw new StateError(
        `Invalid step output for ${stepName} in execution ${executionId}`,
      );
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
    for (const status of knownStatuses) {
      if (status === value) {
        return status;
      }
    }

    return null;
  }
}

export const defineWorkflow = <TInput, TResult = void>(
  options: WorkflowOptions<TInput, TResult>,
): Workflow<TInput, TResult> => {
  const workflow = new WorkflowDefinition(options);

  return {
    start: (input, startOptions) => workflow.start(input, startOptions),
    run: (input, startOptions) => workflow.run(input, startOptions),
    resume: (executionId) => workflow.resume(executionId),
    get: (executionId) => workflow.get(executionId),
    cancel: (executionId) => workflow.cancel(executionId),
  };
};

export {
  CancelledError,
  ExecutionError,
  LockError,
  NotFoundError,
  SerializationError,
  StateError,
  WorkflowError,
} from "./errors.js";
export type {
  StepHandler,
  Workflow,
  WorkflowExecution,
  WorkflowHandlerContext,
  WorkflowMeta,
  WorkflowMetaField,
  WorkflowOptions,
  WorkflowStartOptions,
  WorkflowStartResult,
  WorkflowStatus,
} from "./types.js";

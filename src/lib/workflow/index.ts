import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type {
  StepSnapshot,
  Workflow,
  WorkflowExecution,
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

    const [existsError, exists] = await this.hasExecution(executionId);

    if (existsError || exists === null) {
      return err("WorkflowError", "Unable to verify workflow execution");
    }

    if (exists) {
      return err(
        "WorkflowStateError",
        `Workflow execution ${executionId} already exists`,
      );
    }

    const [createError] = await this.createExecution(executionId, input);

    if (createError) {
      return err(createError.type, createError.message);
    }

    return this.execute(executionId, input);
  }

  public async run(input: TInput, options?: WorkflowStartOptions) {
    const [startError, startData] = await this.start(input, options);

    if (startError || !startData) {
      return err(startError.type, startError.message);
    }

    if (startData.status === "cancelled") {
      return err(
        "WorkflowCancelledError",
        `Workflow execution ${startData.executionId} was cancelled`,
      );
    }

    if (startData.status !== "completed") {
      return err(
        "WorkflowExecutionError",
        `Workflow execution ${startData.executionId} did not complete`,
      );
    }

    const [getError, execution] = await this.get(startData.executionId);

    if (getError || !execution) {
      return err(getError.type, getError.message);
    }

    if (execution.result === null) {
      return err(
        "WorkflowExecutionError",
        `Workflow execution ${startData.executionId} has no result`,
      );
    }

    return ok(execution.result);
  }

  public async resume(executionId: string) {
    const [getError, execution] = await this.get(executionId);

    if (getError || !execution) {
      return err(getError.type, getError.message);
    }

    if (execution.status === "completed") {
      return ok({ executionId, status: execution.status });
    }

    if (execution.status === "cancelled") {
      return ok({ executionId, status: execution.status });
    }

    return this.execute(executionId, execution.input);
  }

  public async get(executionId: string) {
    const [statusError, status] = await this.getMeta(executionId, "status");

    if (statusError) {
      return err(statusError.type, statusError.message);
    }

    if (!status) {
      return err(
        "WorkflowNotFoundError",
        `Workflow execution ${executionId} not found`,
      );
    }

    const normalizedStatus = this.normalizeStatus(status);

    if (!normalizedStatus) {
      return err(
        "WorkflowStateError",
        `Workflow execution ${executionId} has invalid status ${status}`,
      );
    }

    const [inputError, input] = await this.readInput(executionId);

    if (inputError || input === null) {
      return err(
        "WorkflowStateError",
        `Workflow execution ${executionId} has invalid input`,
      );
    }

    const [resultError, result] = await this.readResult(executionId);

    if (resultError) {
      return err(resultError.type, resultError.message);
    }

    const [stepsError, steps] = await this.readStepSnapshots(executionId);

    if (stepsError) {
      return err(stepsError.type, stepsError.message);
    }

    const [createdAtError, createdAt] = await this.readNumberMeta(
      executionId,
      "createdAt",
    );

    if (createdAtError || createdAt === null) {
      return err(
        "WorkflowStateError",
        `Workflow execution ${executionId} is missing createdAt`,
      );
    }

    const [updatedAtError, updatedAt] = await this.readNumberMeta(
      executionId,
      "updatedAt",
    );

    if (updatedAtError || updatedAt === null) {
      return err(
        "WorkflowStateError",
        `Workflow execution ${executionId} is missing updatedAt`,
      );
    }

    const [metaError, errorMessage] = await this.getMeta(executionId, "error");

    if (metaError) {
      return err(metaError.type, metaError.message);
    }

    const [completedAtError, completedAt] = await this.readNumberMeta(
      executionId,
      "completedAt",
    );

    if (completedAtError) {
      return err(completedAtError.type, completedAtError.message);
    }

    const [failedAtError, failedAt] = await this.readNumberMeta(
      executionId,
      "failedAt",
    );

    if (failedAtError) {
      return err(failedAtError.type, failedAtError.message);
    }

    const [cancelledAtError, cancelledAt] = await this.readNumberMeta(
      executionId,
      "cancelledAt",
    );

    if (cancelledAtError) {
      return err(cancelledAtError.type, cancelledAtError.message);
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

    return ok(data);
  }

  public async cancel(executionId: string) {
    const [getError, execution] = await this.get(executionId);

    if (getError || !execution) {
      return err(getError.type, getError.message);
    }

    if (execution.status === "completed") {
      return err(
        "WorkflowStateError",
        `Workflow execution ${executionId} is already completed`,
      );
    }

    const timestamp = now();

    const [statusError] = await this.setMeta(
      executionId,
      "status",
      "cancelled",
    );
    if (statusError) {
      return err(statusError.type, statusError.message);
    }

    const [updatedAtError] = await this.setMeta(
      executionId,
      "updatedAt",
      String(timestamp),
    );
    if (updatedAtError) {
      return err(updatedAtError.type, updatedAtError.message);
    }

    const [cancelledAtError] = await this.setMeta(
      executionId,
      "cancelledAt",
      String(timestamp),
    );
    if (cancelledAtError) {
      return err(cancelledAtError.type, cancelledAtError.message);
    }

    return ok(null);
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

  private async hasExecution(executionId: string) {
    const [readError, status] = await this.getMeta(executionId, "status");

    if (readError) {
      return err(readError.type, readError.message);
    }

    return ok(status !== null);
  }

  private async createExecution(executionId: string, input: TInput) {
    const [serializeError, serializedInput] = this.serializeInput(input);

    if (serializeError) {
      return err(
        "WorkflowSerializationError",
        `Unable to serialize workflow input for ${executionId}`,
      );
    }

    const timestamp = now();

    const fields: [string, string][] = [
      ["status", "pending"],
      ["input", serializedInput],
      ["result", ""],
      ["error", ""],
      ["createdAt", String(timestamp)],
      ["updatedAt", String(timestamp)],
      ["completedAt", ""],
      ["failedAt", ""],
      ["cancelledAt", ""],
      ["steps", "[]"],
    ];

    for (const field of fields) {
      const [name, value] = field;

      const [writeError] = await this.setMeta(executionId, name, value);

      if (writeError) {
        return err(writeError.type, writeError.message);
      }
    }

    return ok(null);
  }

  private async execute(executionId: string, input: TInput) {
    const token = crypto.randomUUID();

    const [lockError] = await this.acquireLock(executionId, token);
    if (lockError) {
      return err(lockError.type, lockError.message);
    }

    const timestamp = now();

    await this.setMeta(executionId, "status", "running");
    await this.setMeta(executionId, "updatedAt", String(timestamp));

    const controller = new AbortController();

    const step = async <TStep>(
      name: string,
      handler: (
        inputValue: TInput,
        signal: AbortSignal,
      ) => TStep | Promise<TStep>,
    ) => {
      const [cancelledError, cancelled] = await this.isCancelled(executionId);

      if (cancelledError) {
        return Promise.reject(new Error(cancelledError.message));
      }

      if (cancelled) {
        controller.abort();
        return Promise.reject(new Error("Workflow cancelled"));
      }

      const [readError, cachedStep] = await this.readStepOutput<unknown>(
        executionId,
        name,
      );

      if (readError || !cachedStep) {
        const message = readError
          ? readError.message
          : `Unable to read step ${name}`;

        return Promise.reject(new Error(message));
      }

      if (cachedStep.found) {
        return cachedStep.value as TStep;
      }

      const [stepError, output] = await mightThrow(
        Promise.resolve(handler(input, controller.signal)),
      );

      if (stepError) {
        return Promise.reject(stepError);
      }

      const [writeError] = await this.writeStepOutput(
        executionId,
        name,
        output,
      );

      if (writeError) {
        return Promise.reject(new Error(writeError.message));
      }

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

    const [cancelledError, cancelled] = await this.isCancelled(executionId);

    if (cancelledError) {
      await this.releaseLock(executionId, token);
      return err(cancelledError.type, cancelledError.message);
    }

    if (cancelled) {
      const cancelledAt = now();

      await this.setMeta(executionId, "status", "cancelled");
      await this.setMeta(executionId, "updatedAt", String(cancelledAt));
      await this.setMeta(executionId, "cancelledAt", String(cancelledAt));
      await this.releaseLock(executionId, token);

      const response: WorkflowStartResult = {
        executionId,
        status: "cancelled",
      };

      return ok(response);
    }

    if (handlerError) {
      const failedAt = now();

      await this.setMeta(executionId, "status", "failed");
      await this.setMeta(executionId, "error", toErrorMessage(handlerError));
      await this.setMeta(executionId, "updatedAt", String(failedAt));
      await this.setMeta(executionId, "failedAt", String(failedAt));
      await this.releaseLock(executionId, token);

      return err(
        "WorkflowExecutionError",
        `Workflow execution ${executionId} failed: ${toErrorMessage(handlerError)}`,
      );
    }

    const [serializeResultError, serializedResult] =
      this.serializeResult(result);

    if (serializeResultError) {
      const failedAt = now();

      await this.setMeta(executionId, "status", "failed");
      await this.setMeta(
        executionId,
        "error",
        serializeResultError
          ? serializeResultError.message
          : `Unable to serialize result for ${executionId}`,
      );
      await this.setMeta(executionId, "updatedAt", String(failedAt));
      await this.setMeta(executionId, "failedAt", String(failedAt));
      await this.releaseLock(executionId, token);

      return err(
        "WorkflowSerializationError",
        `Unable to serialize workflow result for ${executionId}`,
      );
    }

    const completedAt = now();

    await this.setMeta(executionId, "result", serializedResult);
    await this.setMeta(executionId, "status", "completed");
    await this.setMeta(executionId, "error", "");
    await this.setMeta(executionId, "updatedAt", String(completedAt));
    await this.setMeta(executionId, "completedAt", String(completedAt));
    await this.releaseLock(executionId, token);

    const response: WorkflowStartResult = {
      executionId,
      status: "completed",
    };

    return ok(response);
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
      return err(
        "WorkflowLockError",
        `Unable to acquire lock for execution ${executionId}`,
      );
    }

    if (lockResult !== "OK") {
      return err(
        "WorkflowLockError",
        `Workflow execution ${executionId} is already running`,
      );
    }

    return ok(null);
  }

  private async releaseLock(executionId: string, token: string) {
    const [readError, currentToken] = await mightThrow(
      this.options.redis.get(this.lockKey(executionId)),
    );

    if (readError) {
      return err(
        "WorkflowLockError",
        `Unable to read lock for execution ${executionId}`,
      );
    }

    if (currentToken !== token) {
      return ok(null);
    }

    const [deleteError] = await mightThrow(
      this.options.redis.del(this.lockKey(executionId)),
    );

    if (deleteError) {
      return err(
        "WorkflowLockError",
        `Unable to release lock for execution ${executionId}`,
      );
    }

    return ok(null);
  }

  private async isCancelled(executionId: string) {
    const [statusError, status] = await this.getMeta(executionId, "status");

    if (statusError) {
      return err(statusError.type, statusError.message);
    }

    return ok(status === "cancelled");
  }

  private async setMeta(executionId: string, field: string, value: string) {
    const [writeError] = await mightThrow(
      this.options.redis.hset(this.metaKey(executionId), field, value),
    );

    if (writeError) {
      return err(
        "WorkflowError",
        `Unable to persist ${field} for execution ${executionId}`,
      );
    }

    return ok(null);
  }

  private async getMeta(executionId: string, field: string) {
    const [readError, value] = await mightThrow(
      this.options.redis.hget(this.metaKey(executionId), field),
    );

    if (readError) {
      return err(
        "WorkflowError",
        `Unable to read ${field} for execution ${executionId}`,
      );
    }

    if (value === null || value === undefined) {
      return ok(null);
    }

    if (typeof value !== "string") {
      return err(
        "WorkflowStateError",
        `Invalid ${field} value for execution ${executionId}`,
      );
    }

    if (value.length === 0) {
      return ok(null);
    }

    return ok(value);
  }

  private async readNumberMeta(executionId: string, field: string) {
    const [readError, value] = await this.getMeta(executionId, field);

    if (readError) {
      return err(readError.type, readError.message);
    }

    if (!value) {
      return ok(null);
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return err(
        "WorkflowStateError",
        `Invalid ${field} value for execution ${executionId}`,
      );
    }

    return ok(parsed);
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
      return err(
        "WorkflowSerializationError",
        `Unable to serialize ${label}: ${toErrorMessage(serializeError)}`,
      );
    }

    if (typeof serialized !== "string") {
      return err(
        "WorkflowSerializationError",
        `${label} serializer must return a string`,
      );
    }

    return ok(serialized);
  }

  private runDeserializer<T>(
    raw: string,
    deserializer: (v: string) => T,
    label: string,
  ) {
    const [deserializeError, value] = mightThrowSync(() => deserializer(raw));

    if (deserializeError) {
      return err(
        "WorkflowSerializationError",
        `Unable to deserialize ${label}: ${toErrorMessage(deserializeError)}`,
      );
    }

    return ok(value);
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
      return ok(envelopeSerialize(null));
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
    const [readError, raw] = await this.getMeta(executionId, "input");

    if (readError || !raw) {
      return err(
        "WorkflowStateError",
        `Workflow execution ${executionId} input not found`,
      );
    }

    return this.deserializeInput(raw);
  }

  private async readResult(executionId: string) {
    const [readError, raw] = await this.getMeta(executionId, "result");

    if (readError) {
      return err(readError.type, readError.message);
    }

    if (!raw) {
      return ok(null);
    }

    const [deserializeError, result] = this.deserializeResult(raw);

    if (deserializeError) {
      return err(deserializeError.type, deserializeError.message);
    }

    return ok(result);
  }

  private async writeStepOutput(
    executionId: string,
    stepName: string,
    output: unknown,
  ) {
    const [serializeError, serializedOutput] = this.serializeStepOutput(output);

    if (serializeError) {
      return err(
        "WorkflowSerializationError",
        `Unable to serialize step ${stepName} output`,
      );
    }

    const payload = {
      output: serializedOutput,
      completedAt: now(),
    };

    const [payloadError, payloadRaw] = mightThrowSync(() =>
      JSON.stringify(payload),
    );

    if (payloadError || typeof payloadRaw !== "string") {
      return err(
        "WorkflowSerializationError",
        `Unable to persist step ${stepName} output`,
      );
    }

    const [writeError] = await mightThrow(
      this.options.redis.hset(this.stepsKey(executionId), stepName, payloadRaw),
    );

    if (writeError) {
      return err(
        "WorkflowError",
        `Unable to persist step ${stepName} for execution ${executionId}`,
      );
    }

    const [stepNamesError, stepNames] = await this.readStepNames(executionId);

    if (stepNamesError) {
      return err(stepNamesError.type, stepNamesError.message);
    }

    if (!stepNames.includes(stepName)) {
      const nextStepNames = [...stepNames, stepName];

      const [serializeStepsError, serializedSteps] = mightThrowSync(() =>
        JSON.stringify(nextStepNames),
      );

      if (serializeStepsError || typeof serializedSteps !== "string") {
        return err(
          "WorkflowSerializationError",
          `Unable to persist step history for execution ${executionId}`,
        );
      }

      const [updateStepsError] = await this.setMeta(
        executionId,
        "steps",
        serializedSteps,
      );

      if (updateStepsError) {
        return err(updateStepsError.type, updateStepsError.message);
      }
    }

    const [updatedError] = await this.setMeta(
      executionId,
      "updatedAt",
      String(now()),
    );

    if (updatedError) {
      return err(updatedError.type, updatedError.message);
    }

    return ok(null);
  }

  private async readStepOutput<TStep>(executionId: string, stepName: string) {
    const [readError, payloadRaw] = await mightThrow(
      this.options.redis.hget(this.stepsKey(executionId), stepName),
    );

    if (readError) {
      return err(
        "WorkflowError",
        `Unable to read step ${stepName} for execution ${executionId}`,
      );
    }

    if (!payloadRaw) {
      return ok({ found: false, value: null });
    }

    if (typeof payloadRaw !== "string") {
      return err(
        "WorkflowStateError",
        `Invalid step payload for ${stepName} in execution ${executionId}`,
      );
    }

    const [parseError, parsed] = mightThrowSync(() => JSON.parse(payloadRaw));

    if (parseError || parsed === null || typeof parsed !== "object") {
      return err(
        "WorkflowStateError",
        `Invalid step payload for ${stepName} in execution ${executionId}`,
      );
    }

    if (typeof parsed.output !== "string") {
      return err(
        "WorkflowStateError",
        `Invalid step output for ${stepName} in execution ${executionId}`,
      );
    }

    const outputRaw = parsed.output;

    const [deserializeError, value] = this.deserializeStepOutput(outputRaw);

    if (deserializeError) {
      return err(deserializeError.type, deserializeError.message);
    }

    return ok({ found: true, value: value as TStep });
  }

  private async readStepNames(executionId: string) {
    const [readError, stepsRaw] = await this.getMeta(executionId, "steps");

    if (readError) {
      return [readError, []] as const;
    }

    if (!stepsRaw) {
      return ok([] as string[]);
    }

    const [parseError, values] = mightThrowSync(() => JSON.parse(stepsRaw));

    if (parseError || !Array.isArray(values)) {
      return err(
        "WorkflowStateError",
        `Invalid step index for execution ${executionId}`,
      );
    }

    const stepNames: string[] = [];

    for (const value of values) {
      if (typeof value === "string") {
        stepNames.push(value);
      }
    }

    return ok(stepNames);
  }

  private async readStepSnapshots(executionId: string) {
    const [stepNamesError, stepNames] = await this.readStepNames(executionId);

    if (stepNamesError) {
      return [stepNamesError, []] as const;
    }

    const steps: StepSnapshot[] = [];

    for (const stepName of stepNames) {
      const [readError, payloadRaw] = await mightThrow(
        this.options.redis.hget(this.stepsKey(executionId), stepName),
      );

      if (readError) {
        return err(
          "WorkflowError",
          `Unable to read step ${stepName} for execution ${executionId}`,
        );
      }

      if (!payloadRaw) {
        continue;
      }

      if (typeof payloadRaw !== "string") {
        return err(
          "WorkflowStateError",
          `Invalid step payload for ${stepName} in execution ${executionId}`,
        );
      }

      const [parseError, parsed] = mightThrowSync(() => JSON.parse(payloadRaw));

      if (parseError || parsed === null || typeof parsed !== "object") {
        return err(
          "WorkflowStateError",
          `Invalid step payload for ${stepName} in execution ${executionId}`,
        );
      }

      if (typeof parsed.completedAt !== "number") {
        return err(
          "WorkflowStateError",
          `Invalid step payload for ${stepName} in execution ${executionId}`,
        );
      }

      const completedAt = parsed.completedAt;

      steps.push({
        name: stepName,
        completedAt,
      });
    }

    return ok(steps);
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

export type {
  StepHandler,
  Workflow,
  WorkflowError,
  WorkflowExecution,
  WorkflowHandlerContext,
  WorkflowOptions,
  WorkflowStartOptions,
  WorkflowStartResult,
  WorkflowStatus,
} from "./types.js";

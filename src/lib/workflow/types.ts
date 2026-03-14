export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowErrorType =
  | "WorkflowError"
  | "WorkflowNotFoundError"
  | "WorkflowStateError"
  | "WorkflowSerializationError"
  | "WorkflowLockError"
  | "WorkflowExecutionError"
  | "WorkflowCancelledError";

export type WorkflowError = {
  type: WorkflowErrorType;
  message: string;
};

export type StepSnapshot = {
  name: string;
  completedAt: number;
};

export type WorkflowExecution<TInput, TResult> = {
  id: string;
  name: string;
  status: WorkflowStatus;
  input: TInput;
  result: TResult | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedAt: number | null;
  cancelledAt: number | null;
  steps: StepSnapshot[];
};

export type StepHandler<TInput, TStep> = (
  input: TInput,
  signal: AbortSignal,
) => TStep | Promise<TStep>;

export type WorkflowHandlerContext<TInput> = {
  input: TInput;
  executionId: string;
  signal: AbortSignal;
  step: <TStep>(
    name: string,
    handler: StepHandler<TInput, TStep>,
  ) => Promise<TStep>;
};

export type SerializeValue<T> = (value: T) => string;
export type DeserializeValue<T> = (raw: string) => T;

export type WorkflowOptions<TInput, TResult> = {
  name: string;
  redis: Bun.RedisClient;
  handler: (
    context: WorkflowHandlerContext<TInput>,
  ) => TResult | Promise<TResult>;
  lockTTL?: number;
  serializeInput?: SerializeValue<TInput>;
  deserializeInput?: DeserializeValue<TInput>;
  serializeResult?: SerializeValue<TResult>;
  deserializeResult?: DeserializeValue<TResult>;
  serializeStepOutput?: SerializeValue<unknown>;
  deserializeStepOutput?: DeserializeValue<unknown>;
};

export type WorkflowStartOptions = {
  executionId?: string;
};

export type WorkflowStartResult = {
  executionId: string;
  status: WorkflowStatus;
};

export type Workflow<TInput, TResult> = {
  start: (
    input: TInput,
    options?: WorkflowStartOptions,
  ) => Promise<readonly [WorkflowError | null, WorkflowStartResult | null]>;
  run: (
    input: TInput,
    options?: WorkflowStartOptions,
  ) => Promise<readonly [WorkflowError | null, TResult | null]>;
  resume: (
    executionId: string,
  ) => Promise<readonly [WorkflowError | null, WorkflowStartResult | null]>;
  get: (
    executionId: string,
  ) => Promise<
    readonly [WorkflowError | null, WorkflowExecution<TInput, TResult> | null]
  >;
  cancel: (
    executionId: string,
  ) => Promise<readonly [WorkflowError | null, null]>;
};

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

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

export type StepContext<TInput> = {
  input: TInput;
  signal: AbortSignal;
  fail: (message: string) => never;
};

export type StepHandler<TInput, TStep> = (
  context: StepContext<TInput>,
) => TStep | Promise<TStep>;

export type WorkflowHandlerContext<TInput> = {
  input: TInput;
  executionId: string;
  signal: AbortSignal;
  step: <TStep>(
    name: string,
    handler: StepHandler<TInput, TStep>,
  ) => Promise<TStep>;
  sleep: (ms: number) => Promise<void>;
};

export type SerializeValue<T> = (value: T) => string;
export type DeserializeValue<T> = (raw: string) => T;

export type WorkflowStepErrorRecord = {
  attempt: number;
  error: string;
  timestamp: number;
};

export type WorkflowStepRetryContext<TInput> = {
  executionId: string;
  input: TInput;
  stepName: string;
  error: string;
  attempt: number;
  nextRetryDelayMs: number;
  retriesRemaining: number;
};

export type WorkflowStepErrorContext<TInput> = {
  executionId: string;
  input: TInput;
  stepName: string;
  error: string;
  totalAttempts: number;
  errorHistory: WorkflowStepErrorRecord[];
};

export type WorkflowHooks<TInput, TResult> = {
  onStart?: (context: {
    executionId: string;
    input: TInput;
  }) => void | Promise<void>;
  onRetry?: (context: WorkflowStepRetryContext<TInput>) => void | Promise<void>;
  onError?: (context: WorkflowStepErrorContext<TInput>) => void | Promise<void>;
  onComplete?: (context: {
    executionId: string;
    input: TInput;
    result: TResult;
  }) => void | Promise<void>;
  onCancel?: (context: {
    executionId: string;
    input: TInput;
  }) => void | Promise<void>;
};

export type WorkflowRetryBackoff = {
  baseDelay?: number;
  multiplier?: number;
  maxDelay?: number;
};

export type WorkflowOptions<TInput, TResult> = {
  name: string;
  redis: Bun.RedisClient;
  handler: (
    context: WorkflowHandlerContext<TInput>,
  ) => TResult | Promise<TResult>;
  retries?: number;
  retryBackoff?: WorkflowRetryBackoff;
  hooks?: WorkflowHooks<TInput, TResult>;
  lockTTL?: number;
  concurrency?: number;
  partitionBy?: (input: TInput) => string;
  pollInterval?: number;
  serializeInput?: SerializeValue<TInput>;
  deserializeInput?: DeserializeValue<TInput>;
  serializeResult?: SerializeValue<TResult>;
  deserializeResult?: DeserializeValue<TResult>;
  serializeStepOutput?: SerializeValue<unknown>;
  deserializeStepOutput?: DeserializeValue<unknown>;
};

export type WorkflowStartOptions = {
  executionId?: string;
  partitionKey?: string;
};

export type WorkflowStartResult = {
  executionId: string;
  status: WorkflowStatus;
};

export type WorkflowCancelResult = {
  status: WorkflowStatus;
  executionId: string;
  updatedAt: number;
  cancelledAt: number | null;
  createdAt: number;
};

export type WorkflowMeta = {
  name: string;
  status: WorkflowStatus;
  input: string;
  result: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  failedAt: string;
  cancelledAt: string;
  steps: string;
  partitionKey: string;
};

export type Workflow<TInput, TResult> = {
  name: string;
  start: (
    input: TInput,
    options?: WorkflowStartOptions,
  ) => Promise<WorkflowStartResult>;
  resume: (executionId: string) => Promise<WorkflowStartResult>;
  get: (executionId: string) => Promise<WorkflowExecution<TInput, TResult>>;
  cancel: (executionId: string) => Promise<WorkflowCancelResult>;
  stop: () => Promise<void>;
};

export type ActivityTask = {
  executionId: string;
  activityId: string;
  stepName: string;
  attempt: number;
};

export type TimerTask =
  | {
      kind: "timer";
      executionId: string;
      timerId: string;
    }
  | {
      kind: "activity-retry";
      executionId: string;
      activityId: string;
      stepName: string;
      attempt: number;
    };

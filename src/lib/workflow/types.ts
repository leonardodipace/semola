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

export type WorkflowListOptions = {
  name?: string | string[];
  status?: WorkflowStatus | WorkflowStatus[];
};

export type WorkflowListItem = {
  id: string;
  name: string;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedAt: number | null;
  cancelledAt: number | null;
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
  partitionKey: string;
  partitionSlot: string;
  concurrencySlot: string;
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

export type TimerTask =
  | {
      kind: "timer";
      executionId: string;
      timerId: string;
    }
  | {
      kind: "step-retry";
      executionId: string;
      stepId: string;
      stepName: string;
      attempt: number;
    };

export type HistoryEvent =
  | {
      type: "WorkflowStarted";
      input: string;
      partitionKey: string;
      timestamp: number;
    }
  | {
      type: "StepScheduled";
      stepId: string;
      stepName: string;
      attempt: number;
      timestamp: number;
    }
  | {
      type: "StepStarted";
      stepId: string;
      attempt: number;
      timestamp: number;
    }
  | {
      type: "StepCompleted";
      stepId: string;
      stepName: string;
      result: string;
      timestamp: number;
    }
  | {
      type: "StepFailed";
      stepId: string;
      stepName: string;
      error: string;
      retryable: boolean;
      attempt: number;
      timestamp: number;
    }
  | {
      type: "TimerStarted";
      timerId: string;
      fireAt: number;
      timestamp: number;
    }
  | {
      type: "TimerFired";
      timerId: string;
      timestamp: number;
    }
  | {
      type: "WorkflowCancelRequested";
      timestamp: number;
    }
  | {
      type: "WorkflowCancelled";
      timestamp: number;
    }
  | {
      type: "WorkflowCompleted";
      result: string;
      timestamp: number;
    }
  | {
      type: "WorkflowFailed";
      error: string;
      timestamp: number;
    }
  | {
      type: "WorkflowResumed";
      timestamp: number;
    };

export type StepState =
  | {
      status: "scheduled" | "started";
      stepName: string;
      attempt: number;
    }
  | {
      status: "completed";
      stepName: string;
      result: string;
      completedAt: number;
    }
  | {
      status: "failed";
      stepName: string;
      error: string;
      retryable: boolean;
      attempt: number;
    };

export type TimerState =
  | { status: "started"; fireAt: number; delayMs: number }
  | { status: "fired"; delayMs: number };

export type HistoryTerminal =
  | { kind: "completed"; result: string }
  | { kind: "failed"; error: string }
  | { kind: "cancelled" };

export type HistoryView = {
  events: HistoryEvent[];
  input: string;
  partitionKey: string;
  steps: Map<string, StepState>;
  timers: Map<string, TimerState>;
  cancelRequested: boolean;
  terminal: HistoryTerminal | null;
};

export type ResolvePartitionKeyInput<TInput, TResult> = {
  options: WorkflowOptions<TInput, TResult>;
  input: TInput;
  startOptions: WorkflowStartOptions;
};

export type WorkflowDecision =
  | {
      type: "runStep";
      stepId: string;
      stepName: string;
      attempt: number;
      handler: StepHandler<unknown, unknown>;
      events: HistoryEvent[];
    }
  | {
      type: "sleep";
      timerId: string;
      fireAt: number;
      events: HistoryEvent[];
    }
  | { type: "waiting" }
  | { type: "complete"; result: string; events: HistoryEvent[] }
  | { type: "fail"; error: string; events: HistoryEvent[] }
  | { type: "cancel"; events: HistoryEvent[] };

export type BackoffDelayInput = {
  attempt: number;
  base: number;
  multiplier: number;
  max: number;
};

export type AdvanceInput<TInput, TResult> = {
  options: WorkflowOptions<TInput, TResult>;
  view: HistoryView;
  executionId: string;
  signal: AbortSignal;
  retries: number;
};

export type WithLeaseInput = {
  executionId: string;
  work: (token: string) => Promise<void>;
  onBusy?: () => Promise<void>;
};

export type ExecuteStepInput = {
  executionId: string;
  stepId: string;
  stepName: string;
  attempt: number;
  handler: StepHandler<unknown, unknown>;
  rawInput: string;
  partitionKey: string;
  partitionSlot: number | undefined;
  token: string;
};

export type HandleStepFailureInput = {
  executionId: string;
  stepId: string;
  stepName: string;
  attempt: number;
  rawInput: string;
  partitionKey: string;
  partitionSlot: number | undefined;
  stepError: Error;
  view: HistoryView;
  token: string;
};

export type FailAfterStepExhaustedInput = {
  executionId: string;
  stepName: string;
  attempt: number;
  rawInput: string;
  partitionKey: string;
  partitionSlot: number | undefined;
  message: string;
  errorHistory: WorkflowStepErrorRecord[];
  token: string;
};

export type CollectErrorHistoryInput = {
  events: HistoryEvent[];
  stepId: string;
  attempt: number;
  error: string;
  timestamp: number;
};

export type FireDurableTimerInput = {
  executionId: string;
  timerId: string;
  token: string;
};

export type ClearExecutionLocalStateInput = {
  executionId: string;
  partitionKey: string;
  partitionSlot: number | undefined;
};

export type CompleteExecutionInput = {
  executionId: string;
  result: string;
  rawInput: string;
  partitionKey: string;
  partitionSlot: number | undefined;
  token: string;
};

export type FailExecutionInput = {
  executionId: string;
  error: string;
  partitionKey: string;
  partitionSlot: number | undefined;
  token: string;
};

export type CancelExecutionInput = {
  executionId: string;
  rawInput: string;
  partitionKey: string;
  partitionSlot: number | undefined;
  token: string;
};

export type FinalizeFromTerminalInput = {
  executionId: string;
  terminal: HistoryTerminal;
  rawInput: string;
  token: string;
};

export type PartitionKeyInput = {
  name: string;
  partitionKey: string;
  slot: number;
};

export type AppendEventsInput = {
  executionId: string;
  events: HistoryEvent[];
  leaseToken?: string;
};

export type SetMetaInput = {
  executionId: string;
  fields: Partial<WorkflowMeta>;
  leaseToken?: string;
};

export type AcquireLeaseInput = {
  executionId: string;
  token: string;
  ttlMs: number;
};

export type ExtendLeaseInput = {
  executionId: string;
  token: string;
  ttlMs: number;
};

export type ClaimPartitionInput = {
  partitionKey: string;
  executionId: string;
  concurrency: number;
  ttlMs: number;
};

export type RefreshPartitionInput = {
  partitionKey: string;
  slot: number;
  executionId: string;
  ttlMs: number;
};

export type ReleasePartitionInput = {
  partitionKey: string;
  slot: number;
  executionId: string;
};

export type ReleaseOwnedPartitionsInput = {
  partitionKey: string;
  executionId: string;
  concurrency: number;
};

export type UpdateStatusInput = {
  executionId: string;
  status: WorkflowStatus;
  extra?: Partial<WorkflowMeta>;
  leaseToken?: string;
};

export type RedisZMember = {
  score: number;
  member: string;
};

export type CapacityTarget = {
  key: string;
  field: "partitionSlot" | "concurrencySlot";
};

export type EnsureCapacityInput = {
  executionId: string;
  token: string;
  partitionKey: string;
  meta: WorkflowMeta;
};

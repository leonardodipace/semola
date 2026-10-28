export type WorkflowStatus =
  | "pending"
  | "running"
  | "compensating"
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
  fail: (error: Error) => never;
};

export type StepHandler<TInput, TStep> = (
  context: StepContext<TInput>,
) => TStep | Promise<TStep>;

// `completed` tells whether the step finished. A step that failed, was cut
// short by cancel, or never got to run its handler is undone with
// `completed: false` and no result.
export type StepCompensateContext<TInput, TStep> = {
  input: TInput;
  signal: AbortSignal;
  fail: (error: Error) => never;
} & (
  | { completed: true; result: TStep }
  | { completed: false; result: undefined }
);

export type StepCompensateHandler<TInput, TStep> = (
  context: StepCompensateContext<TInput, TStep>,
) => void | Promise<void>;

export type StepOptions<TInput, TStep> = {
  compensate?: StepCompensateHandler<TInput, TStep>;
};

export type WorkflowHandlerContext<TInput> = {
  input: TInput;
  executionId: string;
  signal: AbortSignal;
  step: <TStep>(
    name: string,
    handler: StepHandler<TInput, TStep>,
    options?: StepOptions<TInput, TStep>,
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
  error: Error;
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
  retentionTTL?: number;
  retentionMax?: number;
  concurrency?: number;
  partitionBy?: (input: TInput) => string;
  pollInterval?: number;
};

export type WorkflowStartOptions = {
  executionId?: string;
  partitionKey?: string;
};

export type WorkflowStartSyncOptions = WorkflowStartOptions & {
  timeoutMs?: number;
  cancelOnTimeout?: boolean;
};

export type WorkflowStartSyncStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type WorkflowStartSyncResult<TResult> = {
  executionId: string;
  status: WorkflowStartSyncStatus;
  result: TResult | null;
  error: Error | null;
};

export type WorkflowStartResult = {
  executionId: string;
  status: "pending";
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
  // Set by cancel() while the execution is pending/running; cleared by resume.
  cancelRequestedAt: string;
  // The forward failure that started an unwind, kept when `error` is later
  // replaced by an undo's error. Absent when no failure started an unwind.
  originalError?: string;
  // Set when an unwind starts; resume rejects the execution from then on.
  unwoundAt?: string;
};

export type Workflow<TInput, TResult> = {
  name: string;
  start: (
    input: TInput,
    options?: WorkflowStartOptions,
  ) => Promise<WorkflowStartResult>;
  startSync: (
    input: TInput,
    options?: WorkflowStartSyncOptions,
  ) => Promise<WorkflowStartSyncResult<TResult>>;
  resume: (executionId: string) => Promise<WorkflowStartResult>;
  get: (executionId: string) => Promise<WorkflowExecution<TInput, TResult>>;
  cancel: (executionId: string) => Promise<WorkflowCancelResult>;
  stop: () => Promise<void>;
};

export type HistoryEvent =
  | {
      type: "WorkflowStarted";
      timestamp: number;
    }
  | {
      type: "StepStarted";
      stepId: string;
      stepName: string;
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
    }
  | {
      type: "CompensationStarted";
      reason: "failed" | "cancelled";
      error: string | null;
      stepIds: string[];
      timestamp: number;
    };

export type StepState =
  // `attempt` runs next: it started and never finished, or resume reset it.
  | {
      status: "started";
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
      failedAt: number;
    };

export type TimerState =
  | { status: "started"; fireAt: number; delayMs: number }
  | { status: "fired"; delayMs: number };

export type CompensationPhase = {
  reason: "failed" | "cancelled";
  error: string | null;
  stepIds: string[];
};

export type HistoryView = {
  events: HistoryEvent[];
  // Forward steps by id (`a<N>`).
  steps: Map<string, StepState>;
  // Undo steps, keyed by the forward step id they undo.
  undos: Map<string, StepState>;
  timers: Map<string, TimerState>;
  // Forward step ids with a StepStarted event: the steps an unwind must undo.
  started: Set<string>;
  compensation: CompensationPhase | null;
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
    }
  | { type: "record"; events: HistoryEvent[] }
  | { type: "waiting"; until: number }
  | { type: "complete"; result: string; events: HistoryEvent[] }
  | { type: "fail"; error: string; events: HistoryEvent[] }
  | { type: "cancel"; events: HistoryEvent[] };

export type TerminalDecision = Extract<
  WorkflowDecision,
  { type: "fail" | "cancel" }
>;

export type NextStepTarget = {
  stepId: string;
  stepName: string;
  handler: StepHandler<unknown, unknown>;
};

export type RetryPolicy = {
  now: number;
  retries: number;
  backoff: (attempt: number) => number;
};

export type Replay = {
  decision: WorkflowDecision;
  // Undo handlers of started steps, in start order.
  undo: CompensationItem[];
  // Set when the replay diverged from history (no unwind is attempted).
  fatal?: string;
};

export type BackoffDelayInput = {
  attempt: number;
  base: number;
  multiplier: number;
  max: number;
};

export type AdvanceInput<TInput, TResult> = {
  options: WorkflowOptions<TInput, TResult>;
  view: HistoryView;
  input: TInput;
  executionId: string;
  signal: AbortSignal;
  retries: number;
  backoff: (attempt: number) => number;
  cancelRequested: boolean;
};

export type ExecuteStepInput<TInput = unknown> = {
  executionId: string;
  stepId: string;
  stepName: string;
  attempt: number;
  handler: StepHandler<unknown, unknown>;
  run: LeaseRun<TInput>;
};

export type HandleStepFailureInput<TInput = unknown> = {
  executionId: string;
  stepId: string;
  stepName: string;
  attempt: number;
  stepError: Error;
  run: LeaseRun<TInput>;
};

export type CompensationItem = {
  stepId: string;
  stepName: string;
  compensate: StepCompensateHandler<unknown, unknown>;
  outcome:
    | { completed: true; result: unknown }
    | { completed: false; result: undefined };
};

export type FinishCompensationInput<TInput = unknown> = {
  executionId: string;
  reason: "failed" | "cancelled";
  error: string | null;
  run: LeaseRun<TInput>;
};

export type CollectErrorHistoryInput = {
  events: HistoryEvent[];
  stepId: string;
  attempt: number;
  error: string;
  timestamp: number;
};

export type CompleteExecutionInput<TInput = unknown> = {
  executionId: string;
  events: HistoryEvent[];
  result: string;
  run: LeaseRun<TInput>;
};

export type FailExecutionInput = {
  executionId: string;
  events: HistoryEvent[];
  error: string;
  run: LeaseRun;
};

export type CancelExecutionInput<TInput = unknown> = {
  executionId: string;
  events: HistoryEvent[];
  run: LeaseRun<TInput>;
};

export type CommitTerminalInput = {
  executionId: string;
  events: HistoryEvent[];
  fields: Partial<WorkflowMeta>;
  endedAt: number;
  run: LeaseRun;
};

export type LeaseInput = {
  executionId: string;
  token: string;
  ttlMs: number;
  // Capacity key of the slot that follows the lease ("*" by default).
  capacityKey?: string;
};

export type ReleaseLeaseInput = LeaseInput & { dueAt: number };

export type CommitRetention = {
  ttlMs?: number;
  trackedAt?: number;
};

export type CommitInput = {
  executionId: string;
  leaseToken: string;
  events?: HistoryEvent[];
  fields?: Partial<WorkflowMeta>;
  // Next time the execution needs advancing (ignored when terminal).
  dueAt?: number;
  // Capacity key whose slot a terminal commit frees ("*" by default).
  capacityKey?: string;
  // With dueAt, keeps a held capacity slot until dueAt + slotTtlMs, so a
  // crash before releaseLease still holds the slot through the wait.
  slotTtlMs?: number;
  // Present only for terminal transitions: leave the due set + retention.
  retention?: CommitRetention;
};

export type CommitResult =
  | { committed: false }
  | { committed: true; cancelRequested: boolean };

export type CancelRequestResult = {
  accepted: boolean;
  status: WorkflowStatus;
  updatedAt: string;
  cancelledAt: string;
  createdAt: string;
};

// In-memory state of one lease: history is only written by the lease holder
// while it holds the lease, so the view is loaded once and kept current by
// applying each committed event. cancelRequested comes from meta at lease
// start and from every commit afterwards.
export type LeaseRun<TInput = unknown> = {
  token: string;
  // Workflow input, parsed once from meta when the lease starts.
  input: TInput;
  view: HistoryView;
  cancelRequested: boolean;
  // Due score committed for this execution; released as-is when set.
  dueAt?: number;
  // Capacity key this run was admitted under.
  capacityKey?: string;
  // Aborts this run's forward steps: on stop() or a lost lease.
  controller: AbortController;
  // Set by the heartbeat once the lease could not be extended.
  lost: boolean;
};

export type RunCommitInput = Omit<CommitInput, "executionId" | "leaseToken">;

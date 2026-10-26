import { mightThrow, mightThrowSync } from "../errors/index.js";
import { NonRetryableStepError, Paused, WorkflowStoreError } from "./errors.js";
import {
  applyHistoryEvent,
  isTerminalStatus,
  parseHistory,
} from "./history.js";
import { fromJson, toJson } from "./json.js";
import type { WorkflowStore } from "./store.js";
import type {
  AdvanceInput,
  BackoffDelayInput,
  CancelExecutionInput,
  ClearExecutionLocalStateInput,
  CollectCompensationsInput,
  CollectErrorHistoryInput,
  CommitRetention,
  CommitTerminalInput,
  CompensationHandlersMissingInput,
  CompensationItem,
  CompensationStartResult,
  CompleteExecutionInput,
  EnsureCapacityInput,
  ExecuteCompensationInput,
  ExecuteStepInput,
  FailAfterStepExhaustedInput,
  FailExecutionInput,
  FailFromCompensationInput,
  FinishCompensationInput,
  FireDurableTimerInput,
  HandleStepFailureInput,
  HistoryEvent,
  LeaseRun,
  MaybeStartCompensationInput,
  RunCommitInput,
  RunCompensationPhaseInput,
  StepCompensateHandler,
  StepHandler,
  TimerTask,
  WithLeaseInput,
  WorkflowDecision,
  WorkflowMeta,
  WorkflowOptions,
  WorkflowStepErrorRecord,
} from "./types.js";

const DEFAULT_RETRIES = 3;
const DEFAULT_LOCK_TTL = 300_000;
const DEFAULT_RETENTION_TTL = 86_400_000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_POLL_INTERVAL = 100;
const DEFAULT_RETRY_BASE = 1000;
const DEFAULT_RETRY_MULTIPLIER = 2;
const DEFAULT_RETRY_MAX = 30_000;
const HEARTBEAT_RATIO = 0.4;
const SHUTDOWN_POLL = 10;
const GLOBAL_CAPACITY_KEY = "*";

const nonRetryableViaFail = new WeakSet<Error>();

const failWith = (error: Error): never => {
  nonRetryableViaFail.add(error);
  throw error;
};

const isNonRetryableStepError = (error: Error) => {
  if (error instanceof NonRetryableStepError) return true;
  if (nonRetryableViaFail.has(error)) return true;
  return false;
};

const runHook = async (fn: (() => void | Promise<void>) | undefined) => {
  if (!fn) return;

  // Defer so sync throws become rejections that mightThrow can swallow.
  await mightThrow(Promise.resolve().then(() => fn()));
};

const backoffDelay = (input: BackoffDelayInput) => {
  const { attempt, base, multiplier, max } = input;

  return Math.min(base * multiplier ** (attempt - 1), max);
};

const sleepMs = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const invalidSleepDelay = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) {
    return new Error("sleep(ms) requires a non-negative finite number");
  }

  return null;
};

const stepNameMismatch = (
  stepId: string,
  expected: string | undefined,
  actual: string,
) => {
  if (expected === undefined) return null;
  if (expected === actual) return null;

  return new Error(
    `nondeterminism: step ${stepId} expected "${expected}", got "${actual}"`,
  );
};

const timerDelayMismatch = (
  timerId: string,
  expected: number | undefined,
  actual: number,
) => {
  if (expected === undefined) return null;
  if (expected === actual) return null;

  return new Error(
    `nondeterminism: timer ${timerId} expected delay ${expected}, got ${actual}`,
  );
};

const advance = async <TInput, TResult>(
  input: AdvanceInput<TInput, TResult>,
): Promise<WorkflowDecision> => {
  const { options, view, executionId, signal, retries, cancelRequested } =
    input;
  const now = Date.now();

  if (view.terminal) {
    return { type: "waiting" };
  }

  // Only cancel() requests end the run. stop() aborts the signal to
  // interrupt handlers but must not write WorkflowCancelled.
  if (cancelRequested) {
    return {
      type: "cancel",
      events: [{ type: "WorkflowCancelled", timestamp: now }],
    };
  }

  const consumed = {
    steps: new Set<string>(),
    timers: new Set<string>(),
  };

  let decision: WorkflowDecision | null = null;
  let stepSeq = 0;
  let timerSeq = 0;
  const workflowInput = fromJson<TInput>(view.input, "input");

  const [handlerError, result] = await mightThrow(
    Promise.resolve(
      options.handler({
        input: workflowInput,
        executionId,
        signal,
        step: async (name, handler) => {
          const stepId = `a${stepSeq++}`;
          consumed.steps.add(stepId);

          const state = view.steps.get(stepId);

          const nameError = stepNameMismatch(stepId, state?.stepName, name);

          if (nameError) throw nameError;

          if (state?.status === "completed") {
            return fromJson(state.result, `step ${name}`) as never;
          }

          if (decision) {
            throw new Paused();
          }

          if (state?.status === "failed") {
            if (!state.retryable || state.attempt > retries) {
              throw new Error(state.error);
            }

            decision = { type: "waiting" };
            throw new Paused();
          }

          if (state?.status === "scheduled" || state?.status === "started") {
            decision = {
              type: "runStep",
              stepId,
              stepName: name,
              attempt: state.attempt,
              handler: handler as StepHandler<unknown, unknown>,
              events: [],
            };
            throw new Paused();
          }

          decision = {
            type: "runStep",
            stepId,
            stepName: name,
            attempt: 1,
            handler: handler as StepHandler<unknown, unknown>,
            events: [
              {
                type: "StepScheduled",
                stepId,
                stepName: name,
                attempt: 1,
                timestamp: now,
              },
            ],
          };

          throw new Paused();
        },
        sleep: async (ms) => {
          const delayError = invalidSleepDelay(ms);

          if (delayError) throw delayError;

          const timerId = `t${timerSeq++}`;
          consumed.timers.add(timerId);

          const state = view.timers.get(timerId);
          const delayMismatch = timerDelayMismatch(timerId, state?.delayMs, ms);

          if (delayMismatch) throw delayMismatch;

          if (state?.status === "fired") return;

          if (decision) {
            throw new Paused();
          }

          if (state?.status === "started") {
            decision = { type: "waiting" };
            throw new Paused();
          }

          decision = {
            type: "sleep",
            timerId,
            fireAt: now + ms,
            events: [
              {
                type: "TimerStarted",
                timerId,
                fireAt: now + ms,
                timestamp: now,
              },
            ],
          };

          throw new Paused();
        },
      }),
    ),
  );

  if (handlerError) {
    if (handlerError instanceof Paused && decision) {
      return decision;
    }

    return {
      type: "fail",
      error: handlerError.message,
      events: [
        {
          type: "WorkflowFailed",
          error: handlerError.message,
          timestamp: now,
        },
      ],
    };
  }

  if (cancelRequested) {
    return {
      type: "cancel",
      events: [{ type: "WorkflowCancelled", timestamp: now }],
    };
  }

  for (const stepId of view.steps.keys()) {
    if (consumed.steps.has(stepId)) continue;

    return {
      type: "fail",
      error: `nondeterminism: historical step ${stepId} was not replayed`,
      events: [
        {
          type: "WorkflowFailed",
          error: `nondeterminism: historical step ${stepId} was not replayed`,
          timestamp: now,
        },
      ],
    };
  }

  for (const timerId of view.timers.keys()) {
    if (consumed.timers.has(timerId)) continue;

    return {
      type: "fail",
      error: `nondeterminism: historical timer ${timerId} was not replayed`,
      events: [
        {
          type: "WorkflowFailed",
          error: `nondeterminism: historical timer ${timerId} was not replayed`,
          timestamp: now,
        },
      ],
    };
  }

  const serialized = toJson(result as TResult, "result");

  return {
    type: "complete",
    result: serialized,
    events: [
      {
        type: "WorkflowCompleted",
        result: serialized,
        timestamp: now,
      },
    ],
  };
};

const compensationHandlersMissing = (
  input: CompensationHandlersMissingInput,
) => {
  const { expectedIds, collectedIds, phaseSteps } = input;

  // Corrupt/legacy CompensationStarted without a stepIds snapshot.
  if (expectedIds.length === 0) return true;

  for (const stepId of expectedIds) {
    if (phaseSteps.get(stepId)?.status === "completed") continue;
    if (collectedIds.has(stepId)) continue;

    return true;
  }

  return false;
};

const collectCompensations = async <TInput, TResult>(
  input: CollectCompensationsInput<TInput, TResult>,
) => {
  const { options, view, executionId } = input;
  const items: CompensationItem[] = [];
  const visitedCompleted = new Set<string>();
  const workflowInput = fromJson<TInput>(view.input, "input");
  const signal = new AbortController().signal;
  let stepSeq = 0;
  let timerSeq = 0;
  let fatal: Error | undefined;

  const [handlerError] = await mightThrow(
    Promise.resolve(
      options.handler({
        input: workflowInput,
        executionId,
        signal,
        step: async (name, _handler, stepOptions) => {
          const stepId = `a${stepSeq++}`;
          const state = view.steps.get(stepId);

          const nameError = stepNameMismatch(stepId, state?.stepName, name);

          if (nameError) {
            fatal = nameError;
            throw fatal;
          }

          if (state?.status === "completed") {
            const [parseError, result] = mightThrowSync(() =>
              fromJson(state.result, `step ${name}`),
            );

            if (parseError) {
              fatal = parseError;
              throw fatal;
            }

            visitedCompleted.add(stepId);

            if (stepOptions?.compensate) {
              items.push({
                stepId,
                stepName: name,
                result,
                compensate: stepOptions.compensate as StepCompensateHandler<
                  unknown,
                  unknown
                >,
              });
            }

            return result as never;
          }

          throw new Paused();
        },
        sleep: async (ms) => {
          const delayError = invalidSleepDelay(ms);

          if (delayError) {
            fatal = delayError;
            throw fatal;
          }

          const timerId = `t${timerSeq++}`;
          const state = view.timers.get(timerId);
          const delayMismatch = timerDelayMismatch(timerId, state?.delayMs, ms);

          if (delayMismatch) {
            fatal = delayMismatch;
            throw fatal;
          }

          if (state?.status === "fired") return;

          throw new Paused();
        },
      }),
    ),
  );

  if (fatal) throw fatal;

  const hasUnvisitedCompleted = () => {
    for (const [stepId, state] of view.steps) {
      if (state.status !== "completed") continue;
      if (visitedCompleted.has(stepId)) continue;

      return true;
    }

    return false;
  };

  if (handlerError) {
    if (handlerError instanceof Paused) {
      if (hasUnvisitedCompleted()) {
        throw new Error(
          "nondeterminism: compensation collect paused before every completed step was replayed",
        );
      }

      return items;
    }

    for (const [stepId, state] of view.steps) {
      if (state.status !== "completed") continue;
      if (visitedCompleted.has(stepId)) continue;

      throw handlerError;
    }
  }

  if (hasUnvisitedCompleted()) {
    throw new Error(
      "nondeterminism: compensation collect returned before every completed step was replayed",
    );
  }

  return items;
};

export class WorkflowEngine<TInput, TResult> {
  private running = true;
  private active = 0;
  private readonly options: WorkflowOptions<TInput, TResult>;
  private readonly store: WorkflowStore;
  private readonly retries: number;
  private readonly lockTTL: number;
  private readonly retentionTTL: number;
  private readonly retentionMax: number | undefined;
  private readonly concurrency: number;
  private readonly pollInterval: number;
  private readonly retryBaseDelay: number;
  private readonly retryMultiplier: number;
  private readonly retryMaxDelay: number;
  private readonly aborts = new Map<string, AbortController>();
  private readonly compensationAborts = new Map<string, AbortController>();
  private readonly compensating = new Set<string>();
  private readonly capacitySlots = new Map<string, Map<string, number>>();
  private readonly lostLeases = new Set<string>();

  public constructor(
    options: WorkflowOptions<TInput, TResult>,
    store: WorkflowStore,
  ) {
    this.options = options;
    this.store = store;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.lockTTL = options.lockTTL ?? DEFAULT_LOCK_TTL;
    this.retentionTTL = options.retentionTTL ?? DEFAULT_RETENTION_TTL;
    this.retentionMax = options.retentionMax;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

    if (!(this.retentionTTL >= 0)) {
      throw new WorkflowStoreError(
        "retentionTTL must be a non-negative number",
      );
    }

    if (this.retentionMax !== undefined) {
      if (!Number.isInteger(this.retentionMax)) {
        throw new WorkflowStoreError("retentionMax must be a positive integer");
      }

      if (this.retentionMax < 1) {
        throw new WorkflowStoreError("retentionMax must be a positive integer");
      }
    }

    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.retryBaseDelay = options.retryBackoff?.baseDelay ?? DEFAULT_RETRY_BASE;
    this.retryMultiplier =
      options.retryBackoff?.multiplier ?? DEFAULT_RETRY_MULTIPLIER;
    this.retryMaxDelay = options.retryBackoff?.maxDelay ?? DEFAULT_RETRY_MAX;
  }

  public requestAbort(executionId: string) {
    this.abortController(executionId).abort();
  }

  public start() {
    for (let i = 0; i < this.concurrency; i++) {
      void this.workflowLoop();
    }

    void this.timerLoop();
    void this.reclaimLoop();
  }

  public async stop() {
    this.running = false;

    for (const [executionId, controller] of this.aborts) {
      if (this.compensating.has(executionId)) continue;

      controller.abort();
    }

    for (const executionId of this.compensating) {
      await this.store.enqueue(executionId);
    }

    while (this.hasInFlightWork()) {
      await this.pruneSettledCompensations();

      if (!this.hasInFlightWork()) break;

      await sleepMs(SHUTDOWN_POLL);
    }
  }

  private async pruneSettledCompensations() {
    for (const executionId of this.compensating) {
      const [error, meta] = await mightThrow(this.store.getMeta(executionId));

      if (!error) {
        if (meta) {
          if (!isTerminalStatus(meta.status)) continue;
        }
      }

      this.aborts.delete(executionId);
      this.compensationAborts.delete(executionId);
      this.compensating.delete(executionId);
    }
  }

  private shouldKeepPolling() {
    if (this.running) return true;
    if (this.compensating.size > 0) return true;

    return false;
  }

  private hasInFlightWork() {
    if (this.active > 0) return true;
    if (this.compensating.size > 0) return true;

    return false;
  }

  private shouldDrainExecution(executionId: string) {
    if (this.running) return true;
    if (this.compensating.has(executionId)) return true;

    return false;
  }

  private async workflowLoop() {
    while (this.shouldKeepPolling()) {
      const [error, executionId] = await mightThrow(this.store.dequeue());

      if (error) {
        await sleepMs(this.pollInterval);
        continue;
      }

      if (!executionId) {
        await sleepMs(this.pollInterval);
        continue;
      }

      if (!this.shouldDrainExecution(executionId)) {
        await this.store.enqueue(executionId);
        await sleepMs(this.pollInterval);
        continue;
      }

      this.active++;

      const run = mightThrow(
        this.withLease({
          executionId,
          work: (token) => this.runExecution(executionId, token),
          onBusy: () => this.store.enqueue(executionId),
        }),
      ).finally(() => {
        this.active--;
      });

      if (this.options.partitionBy) {
        void run;
        continue;
      }

      await run;
    }
  }

  private async timerLoop() {
    while (this.shouldKeepPolling()) {
      this.active++;

      try {
        await mightThrow(this.processDueTimers());
      } finally {
        this.active--;
      }

      await sleepMs(this.pollInterval);
    }
  }

  private async reclaimLoop() {
    while (this.running) {
      this.active++;

      try {
        await mightThrow(this.reclaimOrphans());
        await mightThrow(this.refreshHeldPartitions());
      } finally {
        this.active--;
      }

      await sleepMs(Math.max(this.pollInterval, 200));
    }
  }

  private async withLease(input: WithLeaseInput) {
    const { executionId, work, onBusy } = input;
    const token = crypto.randomUUID();
    const acquired = await this.store.acquireLease({
      executionId,
      token,
      ttlMs: this.lockTTL,
    });

    if (!acquired) {
      if (onBusy) {
        await sleepMs(this.pollInterval);
        await onBusy();
      }
      return;
    }

    this.lostLeases.delete(executionId);
    const heartbeat = this.startHeartbeat(executionId, token);

    await mightThrow(work(token));

    clearInterval(heartbeat);

    if (this.lostLeases.has(executionId)) {
      this.lostLeases.delete(executionId);
      this.capacitySlots.delete(executionId);
    }

    await this.store.releaseLease(executionId, token);
  }

  private async ownsLease(executionId: string, token: string) {
    if (this.lostLeases.has(executionId)) return false;

    return (await this.store.getLease(executionId)) === token;
  }

  private abortController(executionId: string) {
    let controller = this.aborts.get(executionId);

    if (!controller) {
      controller = new AbortController();
      this.aborts.set(executionId, controller);
    }

    return controller;
  }

  private compensationAbortController(executionId: string) {
    let controller = this.compensationAborts.get(executionId);

    if (!controller) {
      controller = new AbortController();
      this.compensationAborts.set(executionId, controller);
    }

    return controller;
  }

  private capacityKey(partitionKey: string) {
    if (this.options.partitionBy) {
      return partitionKey || GLOBAL_CAPACITY_KEY;
    }

    return GLOBAL_CAPACITY_KEY;
  }

  private parseSlot(raw: string | undefined) {
    if (!raw) return undefined;

    const slot = Number(raw);

    if (!Number.isInteger(slot)) return undefined;

    if (slot < 0) return undefined;

    return slot;
  }

  private slotsFromMeta(meta: WorkflowMeta | null, partitionKey: string) {
    const slots = new Map<string, number>();

    if (!meta) return slots;

    const partitionSlot = this.parseSlot(meta.partitionSlot);

    if (partitionSlot !== undefined) {
      const key = this.capacityKey(
        partitionKey || meta.partitionKey || GLOBAL_CAPACITY_KEY,
      );
      slots.set(key, partitionSlot);
    }

    return slots;
  }

  private heldSlots(executionId: string, meta: WorkflowMeta | null) {
    const local = this.capacitySlots.get(executionId);

    if (local && local.size > 0) return local;

    return this.slotsFromMeta(meta, meta?.partitionKey ?? "");
  }

  private async ensureCapacity(input: EnsureCapacityInput) {
    const { executionId, token, partitionKey, meta } = input;
    const held = new Map(this.heldSlots(executionId, meta));

    const persistHeld = () => {
      if (held.size === 0) {
        this.capacitySlots.delete(executionId);
        return;
      }

      this.capacitySlots.set(executionId, held);
    };

    const key = this.capacityKey(partitionKey);
    let slot = held.get(key);

    if (
      slot !== undefined &&
      !(await this.store.refreshPartition({
        partitionKey: key,
        slot,
        executionId,
        ttlMs: this.lockTTL,
      }))
    ) {
      held.delete(key);
      slot = undefined;
    }

    if (slot === undefined) {
      const claimed = await this.store.claimPartition({
        partitionKey: key,
        executionId,
        concurrency: this.concurrency,
        ttlMs: this.lockTTL,
      });

      if (claimed === null) {
        persistHeld();
        await sleepMs(this.pollInterval);
        await this.store.enqueue(executionId);
        return null;
      }

      if (
        !(await this.store.setMeta({
          executionId,
          fields: { partitionSlot: String(claimed) },
          leaseToken: token,
        }))
      ) {
        // Meta not durable. Release the Redis claim so refresh cannot pin the slot.
        await this.store.releasePartition({
          partitionKey: key,
          slot: claimed,
          executionId,
        });
        persistHeld();
        return null;
      }

      held.set(key, claimed);
    } else {
      held.set(key, slot);
    }

    persistHeld();
    return held.get(key) ?? null;
  }

  // Lease-holder write: commits, then applies the events to the in-memory
  // view and picks up a cancel request reported by the same script, so the
  // run never re-reads history while it holds the lease.
  private async commitRun(
    executionId: string,
    run: LeaseRun,
    input: RunCommitInput,
  ) {
    const result = await this.store.commit({
      executionId,
      leaseToken: run.token,
      ...input,
    });

    if (!result.committed) return false;

    for (const event of input.events ?? []) {
      applyHistoryEvent(run.view, event);
    }

    if (result.cancelRequested) run.cancelRequested = true;

    return true;
  }

  private async runExecution(executionId: string, token: string) {
    const meta = await this.store.getMeta(executionId);

    // Queue entries can outlive the run (cancel/stop re-enqueue), and ttl 0
    // unlinks meta at terminal commit.
    if (!meta) return;

    if (isTerminalStatus(meta.status)) {
      await this.clearExecutionLocalState({
        executionId,
        partitionKey: meta.partitionKey,
      });
      return;
    }

    const partitionKey = meta.partitionKey || GLOBAL_CAPACITY_KEY;
    const partitionSlot = await this.ensureCapacity({
      executionId,
      token,
      partitionKey,
      meta,
    });

    if (partitionSlot == null) return;

    // The only history read for this lease; commitRun keeps it current.
    const run: LeaseRun = {
      token,
      view: parseHistory(await this.store.loadHistory(executionId)),
      cancelRequested: Boolean(meta.cancelRequestedAt),
    };
    const { view } = run;
    const controller = this.abortController(executionId);

    if (run.cancelRequested) {
      controller.abort();
    }

    if (meta.status === "pending") {
      const updated = await this.commitRun(executionId, run, {
        fields: { status: "running", updatedAt: String(Date.now()) },
      });

      if (!updated) return;

      if (view.events.length === 1) {
        const input = fromJson<TInput>(meta.input, "input");

        await runHook(() =>
          this.options.hooks?.onStart?.({ executionId, input }),
        );
      }
    }

    // After stop(), keep draining compensate unwind for this execution.
    while (this.shouldDrainExecution(executionId)) {
      if (!(await this.ownsLease(executionId, token))) return;

      // Terminal events are committed together with terminal meta, so meta
      // was non-terminal above means no terminal event exists. Guard anyway
      // so a stale view can never commit a second terminal transition.
      if (view.terminal) return;

      if (view.compensation) {
        const cont = await this.runCompensationPhase({
          executionId,
          rawInput: meta.input,
          partitionKey,
          run,
        });

        if (!cont) return;

        continue;
      }

      if (run.cancelRequested) {
        controller.abort();
      }

      const decision = await advance({
        options: this.options,
        view,
        executionId,
        signal: controller.signal,
        retries: this.retries,
        cancelRequested: run.cancelRequested,
      });

      if (decision.type === "waiting") {
        return;
      }

      if (decision.type === "runStep") {
        if (decision.events.length > 0) {
          const appended = await this.commitRun(executionId, run, {
            events: decision.events,
          });

          if (!appended) return;
        }

        const cont = await this.executeStep({
          executionId,
          stepId: decision.stepId,
          stepName: decision.stepName,
          attempt: decision.attempt,
          handler: decision.handler,
          rawInput: meta.input,
          partitionKey,
          run,
        });

        if (!cont) return;

        continue;
      }

      if (decision.type === "sleep") {
        const appended = await this.commitRun(executionId, run, {
          events: decision.events,
        });

        if (!appended) return;

        await this.store.scheduleTimer(decision.fireAt, {
          kind: "timer",
          executionId,
          timerId: decision.timerId,
        });
        return;
      }

      if (decision.type === "complete") {
        await this.completeExecution({
          executionId,
          events: decision.events,
          result: decision.result,
          rawInput: meta.input,
          partitionKey,
          token,
        });
        return;
      }

      if (decision.type === "fail") {
        const compensating = await this.maybeStartCompensation({
          executionId,
          reason: "failed",
          error: decision.error,
          run,
        });

        if (compensating.type === "started") continue;

        await this.failExecution({
          executionId,
          events: decision.events,
          error: decision.error,
          partitionKey,
          token,
        });
        return;
      }

      const compensating = await this.maybeStartCompensation({
        executionId,
        reason: "cancelled",
        error: null,
        run,
      });

      if (compensating.type === "started") continue;

      if (compensating.type === "failed") {
        await this.failExecution({
          executionId,
          events: [
            {
              type: "WorkflowFailed",
              error: compensating.error,
              timestamp: Date.now(),
            },
          ],
          error: compensating.error,
          partitionKey,
          token,
        });
        return;
      }

      await this.cancelExecution({
        executionId,
        events: decision.events,
        rawInput: meta.input,
        partitionKey,
        token,
      });
      return;
    }
  }

  private async executeStep(input: ExecuteStepInput) {
    const {
      executionId,
      stepId,
      stepName,
      attempt,
      handler,
      rawInput,
      partitionKey,
      run,
    } = input;
    const controller = this.abortController(executionId);

    const started = await this.commitRun(executionId, run, {
      events: [
        {
          type: "StepStarted",
          stepId,
          attempt,
          timestamp: Date.now(),
        },
      ],
    });

    if (!started) return false;

    // A cancel reported by this write is honored before the handler runs.
    if (run.cancelRequested) return true;

    const workflowInput = fromJson<TInput>(rawInput, "input");

    const [stepError, stepResult] = await mightThrow(
      Promise.resolve(
        handler({
          input: workflowInput,
          signal: controller.signal,
          fail: failWith,
        }),
      ),
    );

    if (!(await this.ownsLease(executionId, run.token))) return false;

    if (!stepError) {
      const [serializeError, serialized] = mightThrowSync(() =>
        toJson(stepResult, `step ${stepName}`),
      );

      if (serializeError) {
        if (run.cancelRequested) {
          await this.store.enqueue(executionId);
          return false;
        }

        if (controller.signal.aborted) return false;

        return this.handleStepFailure({
          executionId,
          stepId,
          stepName,
          attempt,
          rawInput,
          partitionKey,
          stepError: new NonRetryableStepError(serializeError.message),
          run,
        });
      }

      const completed = await this.commitRun(executionId, run, {
        events: [
          {
            type: "StepCompleted",
            stepId,
            stepName,
            result: serialized,
            timestamp: Date.now(),
          },
        ],
      });

      if (!completed) return false;

      // Persist success before honor cancel so side effects are in history.
      if (run.cancelRequested) {
        await this.store.enqueue(executionId);
      }

      return true;
    }

    if (run.cancelRequested) {
      await this.store.enqueue(executionId);
      return false;
    }

    if (controller.signal.aborted) return false;

    return this.handleStepFailure({
      executionId,
      stepId,
      stepName,
      attempt,
      rawInput,
      partitionKey,
      stepError,
      run,
    });
  }

  private async handleStepFailure(input: HandleStepFailureInput) {
    const {
      executionId,
      stepId,
      stepName,
      attempt,
      rawInput,
      partitionKey,
      stepError,
      run,
    } = input;
    const message = stepError.message;
    const retryable = !isNonRetryableStepError(stepError);
    const now = Date.now();

    const errorHistory = this.collectErrorHistory({
      events: run.view.events,
      stepId,
      attempt,
      error: message,
      timestamp: now,
      failedType: "StepFailed",
    });

    const appended = await this.commitRun(executionId, run, {
      events: [
        {
          type: "StepFailed",
          stepId,
          stepName,
          error: message,
          retryable,
          attempt,
          timestamp: now,
        },
      ],
    });

    if (!appended) return false;

    // A cancel that arrived during the step is reported by this commit.
    if (run.cancelRequested) {
      await this.store.enqueue(executionId);
      return false;
    }

    if (retryable && attempt <= this.retries) {
      const delay = backoffDelay({
        attempt,
        base: this.retryBaseDelay,
        multiplier: this.retryMultiplier,
        max: this.retryMaxDelay,
      });

      const workflowInput = fromJson<TInput>(rawInput, "input");

      await runHook(() =>
        this.options.hooks?.onRetry?.({
          executionId,
          input: workflowInput,
          stepName,
          error: message,
          attempt,
          nextRetryDelayMs: delay,
          retriesRemaining: this.retries - attempt + 1,
        }),
      );

      await this.store.scheduleTimer(Date.now() + delay, {
        kind: "step-retry",
        executionId,
        stepId,
        stepName,
        attempt: attempt + 1,
      });

      return false;
    }

    const compensating = await this.failAfterStepExhausted({
      executionId,
      stepName,
      attempt,
      rawInput,
      partitionKey,
      stepError,
      errorHistory,
      run,
    });

    return compensating;
  }

  private async failAfterStepExhausted(input: FailAfterStepExhaustedInput) {
    const {
      executionId,
      stepName,
      attempt,
      rawInput,
      partitionKey,
      stepError,
      errorHistory,
      run,
    } = input;
    const workflowInput = fromJson<TInput>(rawInput, "input");
    const message = stepError.message;

    await runHook(() =>
      this.options.hooks?.onError?.({
        executionId,
        input: workflowInput,
        stepName,
        error: stepError,
        totalAttempts: attempt,
        errorHistory,
      }),
    );

    const compensating = await this.maybeStartCompensation({
      executionId,
      reason: "failed",
      error: message,
      run,
    });

    if (compensating.type === "started") return true;

    await this.failExecution({
      executionId,
      events: [
        {
          type: "WorkflowFailed",
          error: message,
          timestamp: Date.now(),
        },
      ],
      error: message,
      partitionKey,
      token: run.token,
    });

    return false;
  }

  private async maybeStartCompensation(
    input: MaybeStartCompensationInput,
  ): Promise<CompensationStartResult> {
    const { executionId, reason, error, run } = input;
    const { view } = run;

    if (view.compensation) return { type: "started" };
    if (view.terminal) return { type: "none" };

    const [collectError, items] = await mightThrow(
      collectCompensations({
        options: this.options,
        view,
        executionId,
      }),
    );

    if (collectError) {
      return { type: "failed", error: collectError.message };
    }

    if (items.length === 0) return { type: "none" };

    const now = Date.now();
    const fields: Partial<WorkflowMeta> = {
      status: "compensating",
      updatedAt: String(now),
    };

    if (error) {
      fields.error = error;
    }

    const committed = await this.commitRun(executionId, run, {
      events: [
        {
          type: "CompensationStarted",
          reason,
          error,
          stepIds: items.map((item) => item.stepId),
          timestamp: now,
        },
      ],
      fields,
    });

    if (!committed) return { type: "none" };

    this.aborts.delete(executionId);
    this.compensating.add(executionId);

    return { type: "started" };
  }

  private async runCompensationPhase(input: RunCompensationPhaseInput) {
    const { executionId, rawInput, partitionKey, run } = input;
    const { view, token } = run;
    const phase = view.compensation;

    if (!phase) return false;

    this.compensating.add(executionId);

    const [collectError, items] = await mightThrow(
      collectCompensations({
        options: this.options,
        view,
        executionId,
      }),
    );

    if (collectError) {
      await this.finishCompensation({
        executionId,
        reason: "failed",
        error: collectError.message,
        rawInput,
        partitionKey,
        token,
      });
      return false;
    }

    const collectedIds = new Set(items.map((item) => item.stepId));
    const missingHandlers = compensationHandlersMissing({
      expectedIds: phase.stepIds,
      collectedIds,
      phaseSteps: phase.steps,
    });

    if (missingHandlers) {
      await this.finishCompensation({
        executionId,
        reason: "failed",
        error: "compensation handlers missing after CompensationStarted",
        rawInput,
        partitionKey,
        token,
      });
      return false;
    }

    const byId = new Map(items.map((item) => [item.stepId, item]));

    for (let index = phase.stepIds.length - 1; index >= 0; index--) {
      const stepId = phase.stepIds[index];

      if (!stepId) continue;

      const item = byId.get(stepId);

      if (!item) continue;

      const state = phase.steps.get(item.stepId);

      if (state?.status === "completed") continue;

      if (state?.status === "failed") {
        if (!state.retryable || state.attempt > this.retries) {
          const errorHistory = this.collectErrorHistory({
            events: view.events,
            stepId: item.stepId,
            attempt: state.attempt,
            error: state.error,
            timestamp: Date.now(),
            failedType: "CompensationFailed",
          });

          await this.failFromCompensation({
            executionId,
            stepName: item.stepName,
            attempt: state.attempt,
            error: new Error(state.error),
            errorHistory,
            rawInput,
            partitionKey,
            token,
          });
          return false;
        }

        await this.store.scheduleTimerIfAbsent(Date.now(), {
          kind: "compensation-retry",
          executionId,
          stepId: item.stepId,
          stepName: item.stepName,
          attempt: state.attempt + 1,
        });

        return false;
      }

      let attempt = 1;

      if (state) {
        attempt = state.attempt;
      }

      return this.executeCompensation({
        executionId,
        stepId: item.stepId,
        stepName: item.stepName,
        attempt,
        result: item.result,
        compensate: item.compensate,
        rawInput,
        partitionKey,
        run,
      });
    }

    await this.finishCompensation({
      executionId,
      reason: phase.reason,
      error: phase.error,
      rawInput,
      partitionKey,
      token,
    });

    return false;
  }

  private async executeCompensation(input: ExecuteCompensationInput) {
    const {
      executionId,
      stepId,
      stepName,
      attempt,
      result,
      compensate,
      rawInput,
      partitionKey,
      run,
    } = input;
    const { token } = run;
    const workflowInput = fromJson<TInput>(rawInput, "input");

    const [compensateError] = await mightThrow(
      Promise.resolve(
        compensate({
          input: workflowInput,
          result,
          signal: this.compensationAbortController(executionId).signal,
          fail: failWith,
        }),
      ),
    );

    if (!(await this.ownsLease(executionId, token))) return false;

    if (!compensateError) {
      const completed = await this.commitRun(executionId, run, {
        events: [
          {
            type: "CompensationCompleted",
            stepId,
            stepName,
            timestamp: Date.now(),
          },
        ],
      });

      if (!completed) return false;

      return true;
    }

    const message = compensateError.message;
    const retryable = !isNonRetryableStepError(compensateError);
    const now = Date.now();
    const errorHistory = this.collectErrorHistory({
      events: run.view.events,
      stepId,
      attempt,
      error: message,
      timestamp: now,
      failedType: "CompensationFailed",
    });

    const appended = await this.commitRun(executionId, run, {
      events: [
        {
          type: "CompensationFailed",
          stepId,
          stepName,
          error: message,
          retryable,
          attempt,
          timestamp: now,
        },
      ],
    });

    if (!appended) return false;

    if (retryable && attempt <= this.retries) {
      const delay = backoffDelay({
        attempt,
        base: this.retryBaseDelay,
        multiplier: this.retryMultiplier,
        max: this.retryMaxDelay,
      });

      await this.store.scheduleTimer(Date.now() + delay, {
        kind: "compensation-retry",
        executionId,
        stepId,
        stepName,
        attempt: attempt + 1,
      });

      return false;
    }

    await this.failFromCompensation({
      executionId,
      stepName,
      attempt,
      error: compensateError,
      errorHistory,
      rawInput,
      partitionKey,
      token,
    });

    return false;
  }

  private async failFromCompensation(input: FailFromCompensationInput) {
    const {
      executionId,
      stepName,
      attempt,
      error,
      errorHistory,
      rawInput,
      partitionKey,
      token,
    } = input;
    const workflowInput = fromJson<TInput>(rawInput, "input");

    await runHook(() =>
      this.options.hooks?.onError?.({
        executionId,
        input: workflowInput,
        stepName,
        error,
        totalAttempts: attempt,
        errorHistory,
      }),
    );

    await this.finishCompensation({
      executionId,
      reason: "failed",
      error: error.message,
      rawInput,
      partitionKey,
      token,
    });
  }

  private async finishCompensation(input: FinishCompensationInput) {
    const { executionId, reason, error, rawInput, partitionKey, token } = input;

    if (reason === "cancelled") {
      await this.cancelExecution({
        executionId,
        events: [{ type: "WorkflowCancelled", timestamp: Date.now() }],
        rawInput,
        partitionKey,
        token,
      });
      return;
    }

    const message = error ?? "workflow failed";

    await this.failExecution({
      executionId,
      events: [
        {
          type: "WorkflowFailed",
          error: message,
          timestamp: Date.now(),
        },
      ],
      error: message,
      partitionKey,
      token,
    });
  }

  private collectErrorHistory(input: CollectErrorHistoryInput) {
    const { events, stepId, attempt, error, timestamp, failedType } = input;
    const history: WorkflowStepErrorRecord[] = [];
    let afterResume = 0;

    for (let i = 0; i < events.length; i++) {
      if (events[i]?.type !== "WorkflowResumed") continue;

      afterResume = i + 1;
    }

    for (let i = afterResume; i < events.length; i++) {
      const event = events[i];

      if (!event) continue;
      if (event.type !== failedType) continue;
      if (event.stepId !== stepId) continue;

      history.push({
        attempt: event.attempt,
        error: event.error,
        timestamp: event.timestamp,
      });
    }

    const last = history[history.length - 1];

    if (!last) {
      history.push({ attempt, error, timestamp });
      return history;
    }

    if (last.attempt !== attempt) {
      history.push({ attempt, error, timestamp });
    }

    return history;
  }

  private async processDueTimers() {
    while (this.shouldKeepPolling()) {
      const raw = await this.store.claimDueTimer(Date.now());

      if (!raw) return;

      const [parseError, task] = mightThrowSync(
        () => JSON.parse(raw) as TimerTask,
      );

      if (parseError) {
        await this.store.deadLetterTimer(raw);
        continue;
      }

      if (typeof task !== "object" || task === null) {
        await this.store.deadLetterTimer(raw);
        continue;
      }

      if (task.kind === "step-retry") {
        if (!this.running) {
          await this.store.scheduleTimer(Date.now() + this.pollInterval, task);
          continue;
        }
      }

      if (task.kind === "compensation-retry" || task.kind === "step-retry") {
        await this.withLease({
          executionId: task.executionId,
          work: (token) => this.fireScheduledRetry(task, token),
          onBusy: () => this.store.scheduleTimer(Date.now(), task),
        });
        continue;
      }

      if (task.kind !== "timer") {
        await this.store.deadLetterTimer(raw);
        continue;
      }

      if (!this.running) {
        await this.store.scheduleTimer(Date.now() + this.pollInterval, task);
        continue;
      }

      await this.withLease({
        executionId: task.executionId,
        work: (token) =>
          this.fireDurableTimer({
            executionId: task.executionId,
            timerId: task.timerId,
            token,
          }),
        onBusy: () => this.store.scheduleTimer(Date.now(), task),
      });
    }
  }

  private async fireDurableTimer(input: FireDurableTimerInput) {
    const { executionId, timerId, token } = input;
    const meta = await this.store.getMeta(executionId);

    if (!meta) return;

    if (isTerminalStatus(meta.status)) return;

    if (meta.cancelRequestedAt) {
      await this.store.enqueue(executionId);
      return;
    }

    const view = parseHistory(await this.store.loadHistory(executionId));

    if (view.timers.get(timerId)?.status === "fired") {
      await this.store.enqueue(executionId);
      return;
    }

    const appended = await this.store.commit({
      executionId,
      leaseToken: token,
      events: [
        {
          type: "TimerFired",
          timerId,
          timestamp: Date.now(),
        },
      ],
    });

    if (!appended.committed) return;

    await this.store.enqueue(executionId);
  }

  private async fireScheduledRetry(
    task: Extract<TimerTask, { kind: "step-retry" | "compensation-retry" }>,
    token: string,
  ) {
    const meta = await this.store.getMeta(task.executionId);

    if (!meta) return;

    if (isTerminalStatus(meta.status)) return;

    const view = parseHistory(await this.store.loadHistory(task.executionId));

    if (task.kind === "step-retry") {
      if (view.compensation) {
        await this.store.enqueue(task.executionId);
        return;
      }

      if (meta.cancelRequestedAt) {
        await this.store.enqueue(task.executionId);
        return;
      }

      if (view.steps.get(task.stepId)?.status === "completed") {
        await this.store.enqueue(task.executionId);
        return;
      }
    }

    if (task.kind === "compensation-retry") {
      if (view.compensation?.steps.get(task.stepId)?.status === "completed") {
        await this.store.enqueue(task.executionId);
        return;
      }
    }

    let event: HistoryEvent = {
      type: "CompensationScheduled",
      stepId: task.stepId,
      stepName: task.stepName,
      attempt: task.attempt,
      timestamp: Date.now(),
    };

    if (task.kind === "step-retry") {
      event = {
        type: "StepScheduled",
        stepId: task.stepId,
        stepName: task.stepName,
        attempt: task.attempt,
        timestamp: Date.now(),
      };
    }

    const appended = await this.store.commit({
      executionId: task.executionId,
      leaseToken: token,
      events: [event],
    });

    if (!appended.committed) return;

    await this.store.enqueue(task.executionId);
  }

  private async reclaimOrphans() {
    const active = await this.store.listActive();

    for (const executionId of active) {
      const meta = await this.store.getMeta(executionId);

      // Create, terminal commit and trim keep the active set in step with
      // meta atomically, so these only catch ids left by older versions or
      // keys edited outside the engine.
      if (!meta) {
        await this.store.markInactive(executionId);
        continue;
      }

      if (isTerminalStatus(meta.status)) {
        await this.clearExecutionLocalState({
          executionId,
          partitionKey: meta.partitionKey,
        });
        await this.store.markInactive(executionId);
        continue;
      }

      if ((await this.store.getLease(executionId)) != null) continue;

      const reclaimToken = crypto.randomUUID();
      const acquired = await this.store.acquireLease({
        executionId,
        token: reclaimToken,
        ttlMs: this.lockTTL,
      });

      if (!acquired) continue;

      let waitingOnTimer = false;

      const [error] = await mightThrow(
        (async () => {
          const view = parseHistory(await this.store.loadHistory(executionId));

          for (const [stepId, state] of view.steps) {
            if (state.status === "completed") continue;

            if (state.status === "failed") {
              if (!view.compensation) {
                if (state.retryable && state.attempt <= this.retries) {
                  const added = await this.store.scheduleTimerIfAbsent(
                    Date.now(),
                    {
                      kind: "step-retry",
                      executionId,
                      stepId,
                      stepName: state.stepName,
                      attempt: state.attempt + 1,
                    },
                  );

                  if (!added) waitingOnTimer = true;
                }
              }
            }
          }

          if (!view.compensation) {
            for (const [timerId, state] of view.timers) {
              if (state.status !== "started") continue;

              await this.store.scheduleTimerIfAbsent(state.fireAt, {
                kind: "timer",
                executionId,
                timerId,
              });

              if (state.fireAt > Date.now()) {
                waitingOnTimer = true;
              }
            }
          }

          if (view.compensation) {
            for (const [stepId, state] of view.compensation.steps) {
              if (state.status === "completed") continue;

              if (state.status !== "failed") continue;

              if (!state.retryable) continue;
              if (state.attempt > this.retries) continue;

              const added = await this.store.scheduleTimerIfAbsent(Date.now(), {
                kind: "compensation-retry",
                executionId,
                stepId,
                stepName: state.stepName,
                attempt: state.attempt + 1,
              });

              if (!added) waitingOnTimer = true;
            }
          }
        })(),
      );

      await this.store.releaseLease(executionId, reclaimToken);

      // Bad history must not block reclaim of later active ids.
      if (error) continue;
      if (waitingOnTimer) continue;

      await this.store.enqueue(executionId);
    }
  }

  private async refreshHeldPartitions() {
    for (const [executionId, held] of this.capacitySlots) {
      const meta = await this.store.getMeta(executionId);

      if (!meta) {
        this.capacitySlots.delete(executionId);
        continue;
      }

      if (isTerminalStatus(meta.status)) {
        await this.clearExecutionLocalState({
          executionId,
          partitionKey: meta.partitionKey,
        });
        continue;
      }

      for (const [partitionKey, slot] of held) {
        const refreshed = await this.store.refreshPartition({
          partitionKey,
          slot,
          executionId,
          ttlMs: this.lockTTL,
        });

        if (!refreshed) held.delete(partitionKey);
      }

      if (held.size === 0) this.capacitySlots.delete(executionId);
    }
  }

  private startHeartbeat(executionId: string, token: string) {
    const interval = Math.max(50, Math.floor(this.lockTTL * HEARTBEAT_RATIO));

    return setInterval(() => {
      void (async () => {
        const [error, ok] = await mightThrow(
          this.store.extendLease({
            executionId,
            token,
            ttlMs: this.lockTTL,
          }),
        );

        if (error || !ok) {
          this.lostLeases.add(executionId);
          this.capacitySlots.delete(executionId);
          this.aborts.get(executionId)?.abort();
          return;
        }

        const held = this.capacitySlots.get(executionId);

        if (!held) return;

        for (const [partitionKey, slot] of held) {
          const [refreshError, refreshed] = await mightThrow(
            this.store.refreshPartition({
              partitionKey,
              slot,
              executionId,
              ttlMs: this.lockTTL,
            }),
          );

          if (refreshError) return;

          if (!refreshed) held.delete(partitionKey);
        }

        if (held.size === 0) this.capacitySlots.delete(executionId);
      })();
    }, interval);
  }

  private async clearExecutionLocalState(input: ClearExecutionLocalStateInput) {
    const { executionId, partitionKey } = input;
    const meta = await this.store.getMeta(executionId);
    const held = this.heldSlots(executionId, meta);
    const key = partitionKey || meta?.partitionKey || GLOBAL_CAPACITY_KEY;
    const keys = new Set([this.capacityKey(key)]);

    for (const heldKey of held.keys()) {
      keys.add(heldKey);
    }

    for (const capacityKey of keys) {
      await this.store.releaseOwnedPartitions({
        partitionKey: capacityKey,
        executionId,
        concurrency: this.concurrency,
      });
    }

    this.aborts.delete(executionId);
    this.compensationAborts.delete(executionId);
    this.compensating.delete(executionId);
    this.capacitySlots.delete(executionId);
  }

  private retention(endedAt: number) {
    const retention: CommitRetention = {};

    if (Number.isFinite(this.retentionTTL)) {
      retention.ttlMs = this.retentionTTL;
    }

    if (this.retentionMax !== undefined) {
      if (retention.ttlMs !== 0) {
        retention.trackedAt = endedAt;
      }
    }

    return retention;
  }

  // One lease-fenced script appends the terminal event, writes terminal meta,
  // leaves the active set and applies retention. Partition slots and local
  // state are released afterwards; a crash in between only leaves the slot
  // until its lockTTL expires.
  private async commitTerminal(input: CommitTerminalInput) {
    const { executionId, events, fields, endedAt, partitionKey, token } = input;

    const committed = await this.store.commit({
      executionId,
      leaseToken: token,
      events,
      fields: {
        ...fields,
        partitionSlot: "",
        updatedAt: String(endedAt),
      },
      retention: this.retention(endedAt),
    });

    if (!committed) return false;

    await this.clearExecutionLocalState({
      executionId,
      partitionKey,
    });

    return true;
  }

  // retentionMax trimming stays a follow-up call: it is idempotent, and a
  // crash before it only leaves extra terminal rows until the next terminal
  // commit trims them.
  private async trimRetained() {
    if (this.retentionMax === undefined) return;

    await this.store.trimTerminal(this.retentionMax);
  }

  private async completeExecution(input: CompleteExecutionInput) {
    const { executionId, events, result, rawInput, partitionKey, token } =
      input;
    const now = Date.now();

    const committed = await this.commitTerminal({
      executionId,
      events,
      fields: {
        status: "completed",
        result,
        completedAt: String(now),
        error: "",
      },
      endedAt: now,
      partitionKey,
      token,
    });

    if (!committed) return;

    const workflowInput = fromJson<TInput>(rawInput, "input");

    await runHook(() =>
      this.options.hooks?.onComplete?.({
        executionId,
        input: workflowInput,
        result: fromJson<TResult>(result, "result"),
      }),
    );

    await this.trimRetained();
  }

  private async failExecution(input: FailExecutionInput) {
    const { executionId, events, error, partitionKey, token } = input;
    const now = Date.now();

    const committed = await this.commitTerminal({
      executionId,
      events,
      fields: {
        status: "failed",
        error,
        failedAt: String(now),
      },
      endedAt: now,
      partitionKey,
      token,
    });

    if (!committed) return;

    await this.trimRetained();
  }

  private async cancelExecution(input: CancelExecutionInput) {
    const { executionId, events, rawInput, partitionKey, token } = input;
    const now = Date.now();

    const committed = await this.commitTerminal({
      executionId,
      events,
      fields: {
        status: "cancelled",
        cancelledAt: String(now),
        error: "",
      },
      endedAt: now,
      partitionKey,
      token,
    });

    if (!committed) return;

    const workflowInput = fromJson<TInput>(rawInput, "input");

    await runHook(() =>
      this.options.hooks?.onCancel?.({ executionId, input: workflowInput }),
    );

    await this.trimRetained();
  }
}

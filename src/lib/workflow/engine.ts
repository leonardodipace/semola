import { mightThrow, mightThrowSync } from "../errors/index.js";
import { NonRetryableStepError, Paused, WorkflowStoreError } from "./errors.js";
import {
  applyHistoryEvent,
  emptyHistoryView,
  isTerminalStatus,
  parseHistory,
} from "./history.js";
import { fromJson, toJson } from "./json.js";
import type { WorkflowStore } from "./store.js";
import type {
  AdvanceInput,
  BackoffDelayInput,
  CancelExecutionInput,
  CollectCompensationsInput,
  CollectErrorHistoryInput,
  CommitRetention,
  CommitTerminalInput,
  CompensationHandlersMissingInput,
  CompensationItem,
  CompensationStartResult,
  CompleteExecutionInput,
  ExecuteCompensationInput,
  ExecuteStepInput,
  FailAfterStepExhaustedInput,
  FailExecutionInput,
  FailFromCompensationInput,
  FinishCompensationInput,
  HandleStepFailureInput,
  LeaseRun,
  MaybeStartCompensationInput,
  RunCommitInput,
  RunCompensationPhaseInput,
  StepCompensateHandler,
  StepHandler,
  WorkflowDecision,
  WorkflowMeta,
  WorkflowOptions,
  WorkflowStepErrorRecord,
} from "./types.js";

const DEFAULT_RETRIES = 3;
const DEFAULT_LOCK_TTL = 30_000;
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
  const { options, view, executionId, signal, retries, backoff } = input;
  const { cancelRequested } = input;
  const now = Date.now();

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
    Promise.resolve().then(() =>
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

          let attempt = 1;

          // A failed retryable step runs again once its backoff has elapsed.
          if (state?.status === "failed") {
            if (!state.retryable || state.attempt > retries) {
              throw new Error(state.error);
            }

            const retryAt = state.failedAt + backoff(state.attempt);

            if (now < retryAt) {
              decision = { type: "waiting", until: retryAt };
              throw new Paused();
            }

            attempt = state.attempt + 1;
          }

          decision = {
            type: "runStep",
            stepId,
            stepName: name,
            attempt,
            handler: handler as StepHandler<unknown, unknown>,
            events: [
              {
                type: "StepScheduled",
                stepId,
                stepName: name,
                attempt,
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

          // The first lease holder past fireAt records TimerFired, so the
          // timer stays fired whatever later replicas' clocks say.
          if (state?.status === "started") {
            decision =
              now < state.fireAt
                ? { type: "waiting", until: state.fireAt }
                : {
                    type: "record",
                    events: [{ type: "TimerFired", timerId, timestamp: now }],
                  };
            throw new Paused();
          }

          decision = {
            type: "record",
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

  // A recorded decision wins however the handler ended: user code may catch
  // Paused and return or rethrow something else, which must not complete or
  // fail the run before that step or sleep happens.
  if (decision) return decision;

  if (handlerError) {
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
    Promise.resolve().then(() =>
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
  }

  public async stop() {
    this.running = false;

    for (const [executionId, controller] of this.aborts) {
      if (this.compensating.has(executionId)) continue;

      controller.abort();
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
      const token = crypto.randomUUID();
      const [error, executionId] = await mightThrow(
        this.store.claimDue(token, this.lockTTL),
      );

      if (error || !executionId) {
        await sleepMs(this.pollInterval);
        continue;
      }

      // After stop(), hand everything but compensate unwind back at once.
      if (!this.shouldDrainExecution(executionId)) {
        await this.store.releaseLease({
          executionId,
          token,
          ttlMs: this.lockTTL,
          dueAt: Date.now(),
        });
        await sleepMs(this.pollInterval);
        continue;
      }

      // Each of the `concurrency` pollers runs one execution at a time, so a
      // process never has more than `concurrency` handlers in flight.
      this.active++;

      await mightThrow(this.runClaimed(executionId, token));

      this.active--;
    }
  }

  private async runClaimed(executionId: string, token: string) {
    const run: LeaseRun = {
      token,
      view: emptyHistoryView(),
      cancelRequested: false,
    };

    this.lostLeases.delete(executionId);
    const heartbeat = this.startHeartbeat(executionId, run);
    const [error] = await mightThrow(this.runExecution(executionId, run));

    clearInterval(heartbeat);
    this.lostLeases.delete(executionId);

    // Without a committed due time the execution is due again after one poll
    // interval (never a hot loop). After an error this worker is still alive,
    // so retry after a short delay instead of waiting out the visibility
    // timeout; if Redis itself is down the release fails and that timeout
    // remains the fallback.
    const retryAt =
      Date.now() + Math.max(this.retryBaseDelay, this.pollInterval);
    const dueAt = error
      ? retryAt
      : (run.dueAt ?? Date.now() + this.pollInterval);

    await this.store.releaseLease({
      executionId,
      token,
      ttlMs: this.lockTTL,
      capacityKey: run.capacityKey,
      dueAt,
    });
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
    if (!this.options.partitionBy) return GLOBAL_CAPACITY_KEY;

    return partitionKey || GLOBAL_CAPACITY_KEY;
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
      capacityKey: run.capacityKey,
      ...input,
    });

    if (!result.committed) return false;

    for (const event of input.events ?? []) {
      applyHistoryEvent(run.view, event);
    }

    if (result.cancelRequested) run.cancelRequested = true;

    return true;
  }

  private backoff = (attempt: number) =>
    backoffDelay({
      attempt,
      base: this.retryBaseDelay,
      multiplier: this.retryMultiplier,
      max: this.retryMaxDelay,
    });

  // Commits the next due time; it stays in place when the lease is released.
  private async waitUntil(executionId: string, run: LeaseRun, until: number) {
    if (!(await this.commitRun(executionId, run, { dueAt: until }))) {
      return false;
    }

    run.dueAt = until;
    return true;
  }

  private async runExecution(executionId: string, run: LeaseRun) {
    const { token } = run;
    const meta = await this.store.getMeta(executionId);

    if (!meta) return;

    if (isTerminalStatus(meta.status)) {
      this.clearExecutionLocalState(executionId);
      return;
    }

    run.capacityKey = this.capacityKey(meta.partitionKey);

    const admitted = await this.store.acquireCapacity(
      run.capacityKey,
      executionId,
      this.concurrency,
      this.lockTTL,
    );

    if (!admitted) {
      run.dueAt = Date.now() + this.pollInterval;
      return;
    }

    // The only history read for this lease; commitRun keeps it current.
    run.view = parseHistory(await this.store.loadHistory(executionId));
    run.cancelRequested = Boolean(meta.cancelRequestedAt);
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
        backoff: this.backoff,
        cancelRequested: run.cancelRequested,
      });

      if (decision.type === "waiting") {
        if (!(await this.waitUntil(executionId, run, decision.until))) return;

        // A cancel reported by that commit is handled now, not at wake-up.
        if (!run.cancelRequested) return;

        run.dueAt = undefined;
        continue;
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
          run,
        });

        if (!cont) return;

        continue;
      }

      if (decision.type === "record") {
        const { events } = decision;

        if (!(await this.commitRun(executionId, run, { events }))) return;

        continue;
      }

      if (decision.type === "complete") {
        await this.completeExecution({
          executionId,
          events: decision.events,
          result: decision.result,
          rawInput: meta.input,
          run,
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
          run,
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
          run,
        });
        return;
      }

      await this.cancelExecution({
        executionId,
        events: decision.events,
        rawInput: meta.input,
        run,
      });
      return;
    }
  }

  private async executeStep(input: ExecuteStepInput) {
    const { executionId, stepId, stepName, attempt, handler, rawInput, run } =
      input;
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
      Promise.resolve().then(() =>
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
        if (run.cancelRequested) return true;

        if (controller.signal.aborted) return false;

        return this.handleStepFailure({
          executionId,
          stepId,
          stepName,
          attempt,
          rawInput,
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

      // Success is in history before a pending cancel is honored.
      return completed;
    }

    if (run.cancelRequested) return true;

    if (controller.signal.aborted) return false;

    return this.handleStepFailure({
      executionId,
      stepId,
      stepName,
      attempt,
      rawInput,
      stepError,
      run,
    });
  }

  private async handleStepFailure(input: HandleStepFailureInput) {
    const { executionId, stepId, stepName, attempt, rawInput, stepError, run } =
      input;
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
    if (run.cancelRequested) return true;

    // Replay then waits out the backoff and runs the next attempt.
    if (retryable && attempt <= this.retries) {
      const delay = this.backoff(attempt);
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

      return true;
    }

    const compensating = await this.failAfterStepExhausted({
      executionId,
      stepName,
      attempt,
      rawInput,
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
      run,
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
    const { executionId, rawInput, run } = input;
    const { view } = run;
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
        run,
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
        run,
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
            run,
          });
          return false;
        }

        const retryAt = state.failedAt + this.backoff(state.attempt);

        if (Date.now() < retryAt) {
          await this.waitUntil(executionId, run, retryAt);
          return false;
        }

        return this.commitRun(executionId, run, {
          events: [
            {
              type: "CompensationScheduled",
              stepId: item.stepId,
              stepName: item.stepName,
              attempt: state.attempt + 1,
              timestamp: Date.now(),
            },
          ],
        });
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
        run,
      });
    }

    await this.finishCompensation({
      executionId,
      reason: phase.reason,
      error: phase.error,
      rawInput,
      run,
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
      run,
    } = input;
    const { token } = run;
    const workflowInput = fromJson<TInput>(rawInput, "input");

    const [compensateError] = await mightThrow(
      Promise.resolve().then(() =>
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

    // The compensation phase waits out the backoff and retries.
    if (retryable && attempt <= this.retries) return true;

    await this.failFromCompensation({
      executionId,
      stepName,
      attempt,
      error: compensateError,
      errorHistory,
      rawInput,
      run,
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
      run,
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
      run,
    });
  }

  private async finishCompensation(input: FinishCompensationInput) {
    const { executionId, reason, error, rawInput, run } = input;

    if (reason === "cancelled") {
      await this.cancelExecution({
        executionId,
        events: [{ type: "WorkflowCancelled", timestamp: Date.now() }],
        rawInput,
        run,
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
      run,
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

  private startHeartbeat(executionId: string, run: LeaseRun) {
    const interval = Math.max(50, Math.floor(this.lockTTL * HEARTBEAT_RATIO));

    return setInterval(() => {
      void (async () => {
        const [error, ok] = await mightThrow(
          this.store.extendLease({
            executionId,
            token: run.token,
            ttlMs: this.lockTTL,
            capacityKey: run.capacityKey,
          }),
        );

        if (error || !ok) {
          this.lostLeases.add(executionId);
          this.aborts.get(executionId)?.abort();
        }
      })();
    }, interval);
  }

  private clearExecutionLocalState(executionId: string) {
    this.aborts.delete(executionId);
    this.compensationAborts.delete(executionId);
    this.compensating.delete(executionId);
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
  // leaves the due set, frees the capacity slot and applies retention.
  private async commitTerminal(input: CommitTerminalInput) {
    const { executionId, events, fields, endedAt, run } = input;

    const committed = await this.commitRun(executionId, run, {
      events,
      fields: { ...fields, updatedAt: String(endedAt) },
      retention: this.retention(endedAt),
    });

    if (!committed) return false;

    this.clearExecutionLocalState(executionId);

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
    const { executionId, events, result, rawInput, run } = input;
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
      run,
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
    const { executionId, events, error, run } = input;
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
      run,
    });

    if (!committed) return;

    await this.trimRetained();
  }

  private async cancelExecution(input: CancelExecutionInput) {
    const { executionId, events, rawInput, run } = input;
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
      run,
    });

    if (!committed) return;

    const workflowInput = fromJson<TInput>(rawInput, "input");

    await runHook(() =>
      this.options.hooks?.onCancel?.({ executionId, input: workflowInput }),
    );

    await this.trimRetained();
  }
}

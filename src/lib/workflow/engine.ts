import { mightThrow, mightThrowSync } from "../errors/index.js";
import { NonRetryableStepError, Paused, WorkflowStoreError } from "./errors.js";
import { isTerminalStatus, parseHistory } from "./history.js";
import { fromJson, toJson } from "./json.js";
import type { WorkflowStore } from "./store.js";
import type {
  AdvanceInput,
  BackoffDelayInput,
  CancelExecutionInput,
  CapacityTarget,
  ClearExecutionLocalStateInput,
  CollectErrorHistoryInput,
  CompleteExecutionInput,
  EnsureCapacityInput,
  ExecuteStepInput,
  FailAfterStepExhaustedInput,
  FailExecutionInput,
  FinalizeFromTerminalInput,
  FireDurableTimerInput,
  HandleStepFailureInput,
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

const runHook = async (fn: (() => void | Promise<void>) | undefined) => {
  if (!fn) return;

  await mightThrow(Promise.resolve(fn()));
};

const backoffDelay = (input: BackoffDelayInput) => {
  const { attempt, base, multiplier, max } = input;

  return Math.min(base * multiplier ** (attempt - 1), max);
};

const sleepMs = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const advance = async <TInput, TResult>(
  input: AdvanceInput<TInput, TResult>,
): Promise<WorkflowDecision> => {
  const { options, view, executionId, signal, retries } = input;
  const now = Date.now();

  if (view.terminal) {
    return { type: "waiting" };
  }

  if (signal.aborted || view.cancelRequested) {
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

          if (state && state.stepName !== name) {
            throw new Error(
              `nondeterminism: step ${stepId} expected "${state.stepName}", got "${name}"`,
            );
          }

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

            // Retry timer will re-schedule; do not run yet.
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
          if (!Number.isFinite(ms) || ms < 0) {
            throw new Error("sleep(ms) requires a non-negative finite number");
          }

          const timerId = `t${timerSeq++}`;
          consumed.timers.add(timerId);

          const state = view.timers.get(timerId);

          if (state && state.delayMs !== ms) {
            throw new Error(
              `nondeterminism: timer ${timerId} expected delay ${state.delayMs}, got ${ms}`,
            );
          }

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

  if (signal.aborted || view.cancelRequested) {
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

  return {
    type: "complete",
    result: toJson(result as TResult, "result"),
    events: [
      {
        type: "WorkflowCompleted",
        result: toJson(result as TResult, "result"),
        timestamp: now,
      },
    ],
  };
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
  private readonly capacitySlots = new Map<string, Map<string, number>>();
  private readonly lostLeases = new Set<string>();
  private sweepCursor = "0";

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

    for (const controller of this.aborts.values()) {
      controller.abort();
    }

    while (this.active > 0) {
      await sleepMs(SHUTDOWN_POLL);
    }
  }

  private async workflowLoop() {
    while (this.running) {
      const [error, executionId] = await mightThrow(this.store.dequeue());

      if (error) {
        await sleepMs(this.pollInterval);
        continue;
      }

      if (!executionId) {
        await sleepMs(this.pollInterval);
        continue;
      }

      this.active++;
      await mightThrow(
        this.withLease({
          executionId,
          work: (token) => this.runExecution(executionId, token),
          onBusy: () => this.store.enqueue(executionId),
        }),
      );
      this.active--;
    }
  }

  private async timerLoop() {
    while (this.running) {
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
        await mightThrow(this.sweepRetention());
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

    // RELEASE_IF_OWNER no-ops if token no longer owns the key
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

  private capacityTargets(partitionKey: string): CapacityTarget[] {
    if (partitionKey === GLOBAL_CAPACITY_KEY) {
      return [{ key: GLOBAL_CAPACITY_KEY, field: "partitionSlot" }];
    }

    return [
      { key: GLOBAL_CAPACITY_KEY, field: "concurrencySlot" },
      { key: partitionKey, field: "partitionSlot" },
    ];
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

    const concurrencySlot = this.parseSlot(meta.concurrencySlot);

    if (concurrencySlot !== undefined) {
      slots.set(GLOBAL_CAPACITY_KEY, concurrencySlot);
    }

    const partitionSlot = this.parseSlot(meta.partitionSlot);

    if (partitionSlot !== undefined) {
      const key = partitionKey || meta.partitionKey || GLOBAL_CAPACITY_KEY;
      slots.set(key, partitionSlot);
    }

    return slots;
  }

  private heldSlots(executionId: string, meta: WorkflowMeta | null) {
    const local = this.capacitySlots.get(executionId);

    if (local && local.size > 0) return local;

    return this.slotsFromMeta(meta, meta?.partitionKey ?? "");
  }

  private resolvePartitionSlot(executionId: string, meta: WorkflowMeta | null) {
    const partitionKey = meta?.partitionKey ?? "";
    const held = this.heldSlots(executionId, meta);

    return held.get(partitionKey);
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

    for (const target of this.capacityTargets(partitionKey)) {
      let slot = held.get(target.key);

      if (
        slot !== undefined &&
        !(await this.store.refreshPartition({
          partitionKey: target.key,
          slot,
          executionId,
          ttlMs: this.lockTTL,
        }))
      ) {
        held.delete(target.key);
        slot = undefined;
      }

      if (slot === undefined) {
        const claimed = await this.store.claimPartition({
          partitionKey: target.key,
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
            fields: { [target.field]: String(claimed) },
            leaseToken: token,
          }))
        ) {
          // Meta not durable — release Redis claim so refresh cannot pin the slot.
          await this.store.releasePartition({
            partitionKey: target.key,
            slot: claimed,
            executionId,
          });
          persistHeld();
          return null;
        }

        held.set(target.key, claimed);
      } else {
        held.set(target.key, slot);
      }
    }

    persistHeld();
    return held.get(partitionKey) ?? null;
  }

  private async runExecution(executionId: string, token: string) {
    const meta = await this.store.getMeta(executionId);

    if (!meta) {
      await this.store.markInactive(executionId);
      return;
    }

    if (isTerminalStatus(meta.status)) {
      await this.clearExecutionLocalState({
        executionId,
        partitionKey: meta.partitionKey,
        partitionSlot: this.resolvePartitionSlot(executionId, meta),
      });
      await this.retainTerminal(executionId);
      return;
    }

    let history = await this.store.loadHistory(executionId);

    if (history.length === 0) {
      const appended = await this.store.appendEvents({
        executionId,
        events: [
          {
            type: "WorkflowStarted",
            input: meta.input,
            partitionKey: meta.partitionKey,
            timestamp: Number(meta.createdAt) || Date.now(),
          },
        ],
        leaseToken: token,
      });

      if (!appended) return;

      history = await this.store.loadHistory(executionId);
    }

    const partitionKey = meta.partitionKey || GLOBAL_CAPACITY_KEY;
    const partitionSlot = await this.ensureCapacity({
      executionId,
      token,
      partitionKey,
      meta,
    });

    if (partitionSlot == null) return;

    let view = parseHistory(history);

    if (view.terminal) {
      await this.finalizeFromTerminal({
        executionId,
        terminal: view.terminal,
        rawInput: meta.input,
        token,
      });
      return;
    }

    const controller = this.abortController(executionId);

    if (view.cancelRequested) {
      controller.abort();
    }

    if (meta.status === "pending") {
      const updated = await this.store.updateStatus({
        executionId,
        status: "running",
        extra: {},
        leaseToken: token,
      });

      if (!updated) return;

      if (view.events.length === 1) {
        const input = fromJson<TInput>(meta.input, "input");

        await runHook(() =>
          this.options.hooks?.onStart?.({ executionId, input }),
        );
      }
    }

    // Drain decisions under the same lease until sleep/wait/terminal.
    while (this.running) {
      if (!(await this.ownsLease(executionId, token))) return;

      history = await this.store.loadHistory(executionId);
      view = parseHistory(history);

      if (view.terminal) {
        await this.finalizeFromTerminal({
          executionId,
          terminal: view.terminal,
          rawInput: meta.input,
          token,
        });
        return;
      }

      if (view.cancelRequested) {
        controller.abort();
      }

      const decision = await advance({
        options: this.options,
        view,
        executionId,
        signal: controller.signal,
        retries: this.retries,
      });

      if (decision.type === "waiting") {
        return;
      }

      if (decision.type === "runStep") {
        if (decision.events.length > 0) {
          const appended = await this.store.appendEvents({
            executionId,
            events: decision.events,
            leaseToken: token,
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
          partitionSlot,
          token,
        });

        if (!cont) return;

        continue;
      }

      if (decision.type === "sleep") {
        const appended = await this.store.appendEvents({
          executionId,
          events: decision.events,
          leaseToken: token,
        });

        if (!appended) return;

        await this.store.scheduleTimer(decision.fireAt, {
          kind: "timer",
          executionId,
          timerId: decision.timerId,
        });
        return;
      }

      const appended = await this.store.appendEvents({
        executionId,
        events: decision.events,
        leaseToken: token,
      });

      if (!appended) return;

      if (decision.type === "complete") {
        await this.completeExecution({
          executionId,
          result: decision.result,
          rawInput: meta.input,
          partitionKey,
          partitionSlot,
          token,
        });
        return;
      }

      if (decision.type === "fail") {
        await this.failExecution({
          executionId,
          error: decision.error,
          partitionKey,
          partitionSlot,
          token,
        });
        return;
      }

      await this.cancelExecution({
        executionId,
        rawInput: meta.input,
        partitionKey,
        partitionSlot,
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
      partitionSlot,
      token,
    } = input;
    const controller = this.abortController(executionId);

    const started = await this.store.appendEvents({
      executionId,
      events: [
        {
          type: "StepStarted",
          stepId,
          attempt,
          timestamp: Date.now(),
        },
      ],
      leaseToken: token,
    });

    if (!started) return false;

    const workflowInput = fromJson<TInput>(rawInput, "input");

    const [stepError, stepResult] = await mightThrow(
      Promise.resolve(
        handler({
          input: workflowInput,
          signal: controller.signal,
          fail: (message) => {
            throw new NonRetryableStepError(message);
          },
        }),
      ),
    );

    if (!(await this.ownsLease(executionId, token))) return false;

    if (!stepError) {
      const [serializeError, serialized] = mightThrowSync(() =>
        toJson(stepResult, `step ${stepName}`),
      );

      if (serializeError) {
        const view = parseHistory(await this.store.loadHistory(executionId));

        if (view.cancelRequested || controller.signal.aborted) {
          await this.store.enqueue(executionId);
          return false;
        }

        return this.handleStepFailure({
          executionId,
          stepId,
          stepName,
          attempt,
          rawInput,
          partitionKey,
          partitionSlot,
          stepError: new NonRetryableStepError(
            serializeError instanceof Error
              ? serializeError.message
              : "Unable to serialize step",
          ),
          view,
          token,
        });
      }

      const completed = await this.store.appendEvents({
        executionId,
        events: [
          {
            type: "StepCompleted",
            stepId,
            stepName,
            result: serialized,
            timestamp: Date.now(),
          },
        ],
        leaseToken: token,
      });

      if (!completed) return false;

      // Persist success before honor cancel so side effects are in history.
      const view = parseHistory(await this.store.loadHistory(executionId));

      if (view.cancelRequested || controller.signal.aborted) {
        await this.store.enqueue(executionId);
      }

      return true;
    }

    const view = parseHistory(await this.store.loadHistory(executionId));

    if (view.cancelRequested || controller.signal.aborted) {
      await this.store.enqueue(executionId);
      return false;
    }

    return this.handleStepFailure({
      executionId,
      stepId,
      stepName,
      attempt,
      rawInput,
      partitionKey,
      partitionSlot,
      stepError,
      view,
      token,
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
      partitionSlot,
      stepError,
      view,
      token,
    } = input;
    const message = stepError.message;
    const retryable = !(stepError instanceof NonRetryableStepError);
    const now = Date.now();

    const appended = await this.store.appendEvents({
      executionId,
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
      leaseToken: token,
    });

    if (!appended) return false;

    const afterFail = parseHistory(await this.store.loadHistory(executionId));

    if (afterFail.cancelRequested) {
      await this.store.enqueue(executionId);
      return false;
    }

    const errorHistory = this.collectErrorHistory({
      events: view.events,
      stepId,
      attempt,
      error: message,
      timestamp: now,
    });

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

    await this.failAfterStepExhausted({
      executionId,
      stepName,
      attempt,
      rawInput,
      partitionKey,
      partitionSlot,
      message,
      errorHistory,
      token,
    });

    return false;
  }

  private async failAfterStepExhausted(input: FailAfterStepExhaustedInput) {
    const {
      executionId,
      stepName,
      attempt,
      rawInput,
      partitionKey,
      partitionSlot,
      message,
      errorHistory,
      token,
    } = input;
    const workflowInput = fromJson<TInput>(rawInput, "input");

    await runHook(() =>
      this.options.hooks?.onError?.({
        executionId,
        input: workflowInput,
        stepName,
        error: message,
        totalAttempts: attempt,
        errorHistory,
      }),
    );

    const appended = await this.store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowFailed",
          error: message,
          timestamp: Date.now(),
        },
      ],
      leaseToken: token,
    });

    if (!appended) return;

    await this.failExecution({
      executionId,
      error: message,
      partitionKey,
      partitionSlot,
      token,
    });
  }

  private collectErrorHistory(input: CollectErrorHistoryInput) {
    const { events, stepId, attempt, error, timestamp } = input;
    const history: WorkflowStepErrorRecord[] = [];

    for (const event of events) {
      if (event.type !== "StepFailed") continue;
      if (event.stepId !== stepId) continue;

      history.push({
        attempt: event.attempt,
        error: event.error,
        timestamp: event.timestamp,
      });
    }

    history.push({ attempt, error, timestamp });
    return history;
  }

  private async processDueTimers() {
    while (this.running) {
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
        await this.withLease({
          executionId: task.executionId,
          work: (token) => this.fireStepRetry(task, token),
          onBusy: () => this.store.scheduleTimer(Date.now(), task),
        });
        continue;
      }

      if (task.kind !== "timer") {
        await this.store.deadLetterTimer(raw);
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

    const view = parseHistory(await this.store.loadHistory(executionId));

    if (view.cancelRequested) {
      await this.store.enqueue(executionId);
      return;
    }

    if (view.timers.get(timerId)?.status === "fired") {
      await this.store.enqueue(executionId);
      return;
    }

    const appended = await this.store.appendEvents({
      executionId,
      events: [
        {
          type: "TimerFired",
          timerId,
          timestamp: Date.now(),
        },
      ],
      leaseToken: token,
    });

    if (!appended) return;

    await this.store.enqueue(executionId);
  }

  private async fireStepRetry(
    task: Extract<TimerTask, { kind: "step-retry" }>,
    token: string,
  ) {
    const meta = await this.store.getMeta(task.executionId);

    if (!meta) return;

    if (isTerminalStatus(meta.status)) return;

    const view = parseHistory(await this.store.loadHistory(task.executionId));

    if (view.cancelRequested) {
      await this.store.enqueue(task.executionId);
      return;
    }

    const existing = view.steps.get(task.stepId);

    if (existing?.status === "completed") {
      await this.store.enqueue(task.executionId);
      return;
    }

    const appended = await this.store.appendEvents({
      executionId: task.executionId,
      events: [
        {
          type: "StepScheduled",
          stepId: task.stepId,
          stepName: task.stepName,
          attempt: task.attempt,
          timestamp: Date.now(),
        },
      ],
      leaseToken: token,
    });

    if (!appended) return;

    await this.store.enqueue(task.executionId);
  }

  private async reclaimOrphans() {
    const active = await this.store.listActive();

    for (const executionId of active) {
      const meta = await this.store.getMeta(executionId);

      if (!meta) {
        await this.store.markInactive(executionId);
        continue;
      }

      if (isTerminalStatus(meta.status)) {
        await this.clearExecutionLocalState({
          executionId,
          partitionKey: meta.partitionKey,
          partitionSlot: this.resolvePartitionSlot(executionId, meta),
        });
        await this.retainTerminal(executionId);
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

      try {
        const view = parseHistory(await this.store.loadHistory(executionId));
        let lastResumeIdx = -1;

        for (let i = 0; i < view.events.length; i++) {
          if (view.events[i]?.type === "WorkflowResumed") lastResumeIdx = i;
        }

        for (const [stepId, state] of view.steps) {
          if (state.status === "completed") continue;

          if (state.status === "failed") {
            if (lastResumeIdx >= 0) {
              let scheduledAfterResume = false;

              for (let i = lastResumeIdx + 1; i < view.events.length; i++) {
                const event = view.events[i];

                if (event?.type !== "StepScheduled") continue;
                if (event.stepId !== stepId) continue;

                scheduledAfterResume = true;
                break;
              }

              if (!scheduledAfterResume) {
                await this.store.appendEvents({
                  executionId,
                  events: [
                    {
                      type: "StepScheduled",
                      stepId,
                      stepName: state.stepName,
                      attempt: 1,
                      timestamp: Date.now(),
                    },
                  ],
                  leaseToken: reclaimToken,
                });
              }
            }

            if (state.retryable && state.attempt <= this.retries) {
              const added = await this.store.scheduleTimerIfAbsent(Date.now(), {
                kind: "step-retry",
                executionId,
                stepId,
                stepName: state.stepName,
                attempt: state.attempt + 1,
              });

              if (!added) waitingOnTimer = true;
            }
          }
        }

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
      } finally {
        await this.store.releaseLease(executionId, reclaimToken);
      }

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
          partitionSlot: held.get(meta.partitionKey),
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
    const keys = new Set(this.capacityTargets(key).map((target) => target.key));

    for (const heldKey of held.keys()) {
      keys.add(heldKey);
    }

    await this.store.markInactive(executionId);
    this.aborts.delete(executionId);

    for (const capacityKey of keys) {
      const slot = held.get(capacityKey);

      if (slot !== undefined) {
        await this.store.releasePartition({
          partitionKey: capacityKey,
          slot,
          executionId,
        });
        continue;
      }

      await this.store.releaseOwnedPartitions({
        partitionKey: capacityKey,
        executionId,
        concurrency: this.concurrency,
      });
    }

    this.capacitySlots.delete(executionId);
  }

  private async completeExecution(input: CompleteExecutionInput) {
    const {
      executionId,
      result,
      rawInput,
      partitionKey,
      partitionSlot,
      token,
    } = input;

    const updated = await this.store.updateStatus({
      executionId,
      status: "completed",
      extra: {
        result,
        completedAt: String(Date.now()),
        error: "",
        partitionSlot: "",
        concurrencySlot: "",
      },
      leaseToken: token,
    });

    if (!updated) return;

    await this.clearExecutionLocalState({
      executionId,
      partitionKey,
      partitionSlot,
    });

    const workflowInput = fromJson<TInput>(rawInput, "input");

    await runHook(() =>
      this.options.hooks?.onComplete?.({
        executionId,
        input: workflowInput,
        result: fromJson<TResult>(result, "result"),
      }),
    );

    await this.retainTerminal(executionId);
  }

  private async failExecution(input: FailExecutionInput) {
    const { executionId, error, partitionKey, partitionSlot, token } = input;

    const updated = await this.store.updateStatus({
      executionId,
      status: "failed",
      extra: {
        error,
        failedAt: String(Date.now()),
        partitionSlot: "",
        concurrencySlot: "",
      },
      leaseToken: token,
    });

    if (!updated) return;

    await this.clearExecutionLocalState({
      executionId,
      partitionKey,
      partitionSlot,
    });

    await this.retainTerminal(executionId);
  }

  private async cancelExecution(input: CancelExecutionInput) {
    const { executionId, rawInput, partitionKey, partitionSlot, token } = input;

    const updated = await this.store.updateStatus({
      executionId,
      status: "cancelled",
      extra: {
        cancelledAt: String(Date.now()),
        error: "",
        partitionSlot: "",
        concurrencySlot: "",
      },
      leaseToken: token,
    });

    if (!updated) return;

    await this.clearExecutionLocalState({
      executionId,
      partitionKey,
      partitionSlot,
    });

    const workflowInput = fromJson<TInput>(rawInput, "input");

    await runHook(() =>
      this.options.hooks?.onCancel?.({ executionId, input: workflowInput }),
    );

    await this.retainTerminal(executionId);
  }

  private async retainTerminal(executionId: string) {
    const meta = await this.store.getMeta(executionId);

    if (!meta) return;

    if (!isTerminalStatus(meta.status)) return;

    const infiniteTtl = !Number.isFinite(this.retentionTTL);

    if (infiniteTtl) {
      if (this.retentionMax === undefined) return;
    }

    const endedAt =
      Number(meta.completedAt) ||
      Number(meta.failedAt) ||
      Number(meta.cancelledAt) ||
      Number(meta.updatedAt) ||
      Date.now();

    let ttlMs: number | undefined;
    let trackedAt: number | undefined;

    if (!infiniteTtl) {
      ttlMs = Math.max(0, endedAt + this.retentionTTL - Date.now());
    }

    if (this.retentionMax !== undefined) {
      if (ttlMs !== 0) {
        trackedAt = endedAt;
      }
    }

    await this.store.retainIfTerminal({
      executionId,
      ttlMs,
      endedAt: trackedAt,
    });

    if (this.retentionMax !== undefined) {
      await this.store.trimTerminal(this.retentionMax);
    }
  }

  private async sweepRetention() {
    if (!Number.isFinite(this.retentionTTL)) {
      if (this.retentionMax === undefined) return;
    }

    const scanned = await this.store.scanMetaIds(this.sweepCursor);

    this.sweepCursor = scanned.cursor;

    for (const executionId of scanned.ids) {
      await this.retainTerminal(executionId);
    }
  }

  private async finalizeFromTerminal(input: FinalizeFromTerminalInput) {
    const { executionId, terminal, rawInput, token } = input;
    const meta = await this.store.getMeta(executionId);
    const partitionKey = meta?.partitionKey ?? "";
    const slot = this.resolvePartitionSlot(executionId, meta);

    if (terminal.kind === "completed") {
      await this.completeExecution({
        executionId,
        result: terminal.result,
        rawInput,
        partitionKey,
        partitionSlot: slot,
        token,
      });
      return;
    }

    if (terminal.kind === "failed") {
      await this.failExecution({
        executionId,
        error: terminal.error,
        partitionKey,
        partitionSlot: slot,
        token,
      });
      return;
    }

    await this.cancelExecution({
      executionId,
      rawInput,
      partitionKey,
      partitionSlot: slot,
      token,
    });
  }
}

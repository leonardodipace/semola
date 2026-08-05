import { mightThrow, mightThrowSync } from "../errors/index.js";
import { NonRetryableStepError } from "./errors.js";
import {
  type HistoryEvent,
  isTerminalStatus,
  parseHistory,
} from "./history.js";
import {
  captureStepHandler,
  deserializeWith,
  replayWorkflow,
  serializeWith,
} from "./runtime.js";
import type { WorkflowStore } from "./store.js";
import type {
  StepTask,
  TimerTask,
  WorkflowOptions,
  WorkflowStepErrorRecord,
} from "./types.js";

const DEFAULT_RETRIES = 3;
const DEFAULT_LOCK_TTL = 300_000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_POLL_INTERVAL = 100;
const DEFAULT_RETRY_BASE = 1000;
const DEFAULT_RETRY_MULTIPLIER = 2;
const DEFAULT_RETRY_MAX = 30_000;
const HEARTBEAT_RATIO = 0.4;
const SHUTDOWN_POLL = 10;

const runHook = async (fn: (() => void | Promise<void>) | undefined) => {
  if (!fn) return;

  await mightThrow(Promise.resolve(fn()));
};

const backoffDelay = (
  attempt: number,
  base: number,
  multiplier: number,
  max: number,
) => Math.min(base * multiplier ** (attempt - 1), max);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const parseStepSnapshots = (rawSteps: string) => {
  if (!rawSteps) return [] as { name: string; completedAt: number }[];

  const [error, steps] = mightThrowSync(
    () => JSON.parse(rawSteps) as { name: string; completedAt: number }[],
  );

  if (error) return [];

  if (!Array.isArray(steps)) return [];

  return steps;
};

export class WorkflowWorker<TInput, TResult> {
  private running = true;
  private active = 0;
  private readonly options: WorkflowOptions<TInput, TResult>;
  private readonly store: WorkflowStore;
  private readonly retries: number;
  private readonly lockTTL: number;
  private readonly concurrency: number;
  private readonly pollInterval: number;
  private readonly retryBaseDelay: number;
  private readonly retryMultiplier: number;
  private readonly retryMaxDelay: number;
  private readonly aborts = new Map<string, AbortController>();
  private readonly partitionSlots = new Map<string, number>();
  private readonly lostLeases = new Set<string>();

  public constructor(
    options: WorkflowOptions<TInput, TResult>,
    store: WorkflowStore,
  ) {
    this.options = options;
    this.store = store;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.lockTTL = options.lockTTL ?? DEFAULT_LOCK_TTL;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
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
      void this.stepLoop();
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
      await sleep(SHUTDOWN_POLL);
    }
  }

  private async workflowLoop() {
    while (this.running) {
      const [error, executionId] = await mightThrow(
        this.store.dequeueWorkflow(),
      );

      if (error) {
        await sleep(this.pollInterval);
        continue;
      }

      if (!executionId) {
        await sleep(this.pollInterval);
        continue;
      }

      this.active++;
      await mightThrow(
        this.withLease(
          executionId,
          (token) => this.runWorkflowTask(executionId, token),
          () => this.store.enqueueWorkflow(executionId),
        ),
      );
      this.active--;
    }
  }

  private async stepLoop() {
    while (this.running) {
      const [error, task] = await mightThrow(this.store.dequeueStep());

      if (error) {
        await sleep(this.pollInterval);
        continue;
      }

      if (!task) {
        await sleep(this.pollInterval);
        continue;
      }

      this.active++;
      await mightThrow(
        this.withLease(
          task.executionId,
          (token) => this.runStepTask(task, token),
          () => this.store.enqueueStep(task),
        ),
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

      await sleep(this.pollInterval);
    }
  }

  private async reclaimLoop() {
    while (this.running) {
      this.active++;

      try {
        await mightThrow(this.reclaimOrphans());
      } finally {
        this.active--;
      }

      await sleep(Math.max(this.pollInterval, 200));
    }
  }

  private async withLease(
    executionId: string,
    work: (token: string) => Promise<void>,
    onBusy?: () => Promise<void>,
  ) {
    const token = crypto.randomUUID();
    const acquired = await this.store.acquireLease(
      executionId,
      token,
      this.lockTTL,
    );

    if (!acquired) {
      if (onBusy) {
        await sleep(this.pollInterval);
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
      this.partitionSlots.delete(executionId);
      return;
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

  private async runWorkflowTask(executionId: string, token: string) {
    const meta = await this.store.getMeta(executionId);

    if (!meta) {
      await this.store.markInactive(executionId);
      return;
    }

    if (isTerminalStatus(meta.status)) {
      await this.store.markInactive(executionId);
      return;
    }

    const partitionKey = meta.partitionKey;
    let partitionSlot = this.partitionSlots.get(executionId);

    if (partitionKey) {
      if (
        partitionSlot !== undefined &&
        !(await this.store.refreshPartition(
          partitionKey,
          partitionSlot,
          executionId,
          this.lockTTL,
        ))
      ) {
        this.partitionSlots.delete(executionId);
        partitionSlot = undefined;
      }

      if (partitionSlot === undefined) {
        const slot = await this.store.claimPartition(
          partitionKey,
          executionId,
          this.concurrency,
          this.lockTTL,
        );

        if (slot === null) {
          await sleep(this.pollInterval);
          await this.store.enqueueWorkflow(executionId);
          return;
        }

        partitionSlot = slot;
        this.partitionSlots.set(executionId, slot);
      }
    }

    const view = parseHistory(await this.store.loadHistory(executionId));

    if (view.terminal) {
      await this.finalizeFromTerminal(executionId, view.terminal, meta.input);
      return;
    }

    const controller = this.abortController(executionId);

    if (view.cancelRequested) {
      controller.abort();
    }

    if (meta.status === "pending") {
      await this.store.updateStatus(executionId, "running");

      if (view.events.length === 1) {
        const input = deserializeWith(
          meta.input,
          this.options.deserializeInput,
          "input",
        );

        await runHook(() =>
          this.options.hooks?.onStart?.({ executionId, input }),
        );
      }
    }

    const events = await replayWorkflow(
      this.options,
      view,
      executionId,
      controller.signal,
      async () => {
        const latest = parseHistory(await this.store.loadHistory(executionId));

        return latest.cancelRequested;
      },
    );

    if (!(await this.ownsLease(executionId, token))) return;

    await this.store.appendEvents(executionId, events);

    for (const event of events) {
      if (!(await this.ownsLease(executionId, token))) return;

      if (event.type === "StepScheduled") {
        await this.store.enqueueStep({
          executionId,
          stepId: event.stepId,
          stepName: event.stepName,
          attempt: event.attempt,
        });
        continue;
      }

      if (event.type === "TimerStarted") {
        await this.store.scheduleTimer(event.fireAt, {
          kind: "timer",
          executionId,
          timerId: event.timerId,
        });
        continue;
      }

      if (event.type === "WorkflowCompleted") {
        await this.completeExecution(
          executionId,
          event.result,
          meta.input,
          partitionKey,
          partitionSlot,
        );
        continue;
      }

      if (event.type === "WorkflowFailed") {
        await this.failExecution(
          executionId,
          event.error,
          partitionKey,
          partitionSlot,
        );
        continue;
      }

      if (event.type === "WorkflowCancelled") {
        await this.cancelExecution(
          executionId,
          meta.input,
          partitionKey,
          partitionSlot,
        );
      }
    }
  }

  private async runStepTask(task: StepTask, token: string) {
    const meta = await this.store.getMeta(task.executionId);

    if (!meta) return;

    if (isTerminalStatus(meta.status)) return;

    const view = parseHistory(await this.store.loadHistory(task.executionId));

    if (view.terminal) return;

    if (view.cancelRequested) {
      await this.store.enqueueWorkflow(task.executionId);
      return;
    }

    const existing = view.steps.get(task.stepId);

    if (existing?.status === "completed") {
      await this.store.enqueueWorkflow(task.executionId);
      return;
    }

    const controller = this.abortController(task.executionId);

    const handler = await captureStepHandler(
      this.options,
      view,
      task.executionId,
      task.stepId,
    );

    if (!handler) {
      if (this.lostLeases.has(task.executionId)) return;

      const message = `Unable to resolve step handler for ${task.stepName}`;
      const input = deserializeWith(
        meta.input,
        this.options.deserializeInput,
        "input",
      );

      await runHook(() =>
        this.options.hooks?.onError?.({
          executionId: task.executionId,
          input,
          stepName: task.stepName,
          error: message,
          totalAttempts: task.attempt,
          errorHistory: [
            {
              attempt: task.attempt,
              error: message,
              timestamp: Date.now(),
            },
          ],
        }),
      );

      await this.store.appendEvents(task.executionId, [
        {
          type: "WorkflowFailed",
          error: message,
          timestamp: Date.now(),
        },
      ]);

      await this.failExecution(
        task.executionId,
        message,
        meta.partitionKey,
        this.partitionSlots.get(task.executionId),
      );
      return;
    }

    if (!(await this.ownsLease(task.executionId, token))) return;

    await this.store.appendEvents(task.executionId, [
      {
        type: "StepStarted",
        stepId: task.stepId,
        attempt: task.attempt,
        timestamp: Date.now(),
      },
    ]);

    const input = deserializeWith(
      meta.input,
      this.options.deserializeInput,
      "input",
    );

    const [stepError, stepResult] = await mightThrow(
      Promise.resolve(
        handler({
          input,
          signal: controller.signal,
          fail: (message) => {
            throw new NonRetryableStepError(message);
          },
        }),
      ),
    );

    if (!(await this.ownsLease(task.executionId, token))) return;

    if (!stepError) {
      const serialized = serializeWith(
        stepResult,
        this.options.serializeStepOutput,
        `step ${task.stepName}`,
      );

      const steps = parseStepSnapshots(meta.steps);
      steps.push({
        name: task.stepName,
        completedAt: Date.now(),
      });

      await this.store.appendEvents(task.executionId, [
        {
          type: "StepCompleted",
          stepId: task.stepId,
          stepName: task.stepName,
          result: serialized,
          timestamp: Date.now(),
        },
      ]);

      await this.store.setMeta(task.executionId, {
        steps: JSON.stringify(steps),
        updatedAt: String(Date.now()),
      });

      await this.store.enqueueWorkflow(task.executionId);
      return;
    }

    const latest = parseHistory(await this.store.loadHistory(task.executionId));

    if (latest.cancelRequested || controller.signal.aborted) {
      await this.store.enqueueWorkflow(task.executionId);
      return;
    }

    await this.handleStepFailure(
      task,
      meta.input,
      meta.partitionKey,
      stepError,
      view,
      token,
    );
  }

  private async handleStepFailure(
    task: StepTask,
    rawInput: string,
    partitionKey: string,
    stepError: Error,
    view: ReturnType<typeof parseHistory>,
    token: string,
  ) {
    if (!(await this.ownsLease(task.executionId, token))) return;

    const message = stepError.message;
    const retryable = !(stepError instanceof NonRetryableStepError);
    const now = Date.now();

    await this.store.appendEvents(task.executionId, [
      {
        type: "StepFailed",
        stepId: task.stepId,
        stepName: task.stepName,
        error: message,
        retryable,
        attempt: task.attempt,
        timestamp: now,
      },
    ]);

    const afterFail = parseHistory(
      await this.store.loadHistory(task.executionId),
    );

    if (afterFail.cancelRequested) {
      await this.store.enqueueWorkflow(task.executionId);
      return;
    }

    const errorHistory = this.collectErrorHistory(
      view.events,
      task.stepId,
      task.attempt,
      message,
      now,
    );

    if (retryable && task.attempt <= this.retries) {
      const delay = backoffDelay(
        task.attempt,
        this.retryBaseDelay,
        this.retryMultiplier,
        this.retryMaxDelay,
      );

      const input = deserializeWith(
        rawInput,
        this.options.deserializeInput,
        "input",
      );

      await runHook(() =>
        this.options.hooks?.onRetry?.({
          executionId: task.executionId,
          input,
          stepName: task.stepName,
          error: message,
          attempt: task.attempt,
          nextRetryDelayMs: delay,
          retriesRemaining: this.retries - task.attempt + 1,
        }),
      );

      await this.store.scheduleTimer(Date.now() + delay, {
        kind: "step-retry",
        executionId: task.executionId,
        stepId: task.stepId,
        stepName: task.stepName,
        attempt: task.attempt + 1,
      });
      return;
    }

    await this.failAfterStepExhausted(
      task,
      rawInput,
      partitionKey,
      message,
      errorHistory,
      token,
    );
  }

  private async failAfterStepExhausted(
    task: StepTask,
    rawInput: string,
    partitionKey: string,
    message: string,
    errorHistory: WorkflowStepErrorRecord[],
    token: string,
  ) {
    if (!(await this.ownsLease(task.executionId, token))) return;

    const input = deserializeWith(
      rawInput,
      this.options.deserializeInput,
      "input",
    );

    await runHook(() =>
      this.options.hooks?.onError?.({
        executionId: task.executionId,
        input,
        stepName: task.stepName,
        error: message,
        totalAttempts: task.attempt,
        errorHistory,
      }),
    );

    await this.store.appendEvents(task.executionId, [
      {
        type: "WorkflowFailed",
        error: message,
        timestamp: Date.now(),
      },
    ]);

    await this.failExecution(
      task.executionId,
      message,
      partitionKey,
      this.partitionSlots.get(task.executionId),
    );
  }

  private collectErrorHistory(
    events: HistoryEvent[],
    stepId: string,
    attempt: number,
    error: string,
    timestamp: number,
  ) {
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

      if (parseError) continue;

      const work =
        task.kind === "timer"
          ? () => this.fireDurableTimer(task.executionId, task.timerId)
          : () => this.fireStepRetry(task);

      await this.withLease(task.executionId, work, () =>
        this.store.scheduleTimer(Date.now(), task),
      );
    }
  }

  private async fireDurableTimer(executionId: string, timerId: string) {
    const meta = await this.store.getMeta(executionId);

    if (!meta) return;

    if (isTerminalStatus(meta.status)) return;

    const view = parseHistory(await this.store.loadHistory(executionId));

    if (view.cancelRequested) {
      await this.store.enqueueWorkflow(executionId);
      return;
    }

    if (view.timers.get(timerId)?.status === "fired") {
      await this.store.enqueueWorkflow(executionId);
      return;
    }

    await this.store.appendEvents(executionId, [
      {
        type: "TimerFired",
        timerId,
        timestamp: Date.now(),
      },
    ]);

    await this.store.enqueueWorkflow(executionId);
  }

  private async fireStepRetry(
    task: Extract<TimerTask, { kind: "step-retry" }>,
  ) {
    const meta = await this.store.getMeta(task.executionId);

    if (!meta) return;

    if (isTerminalStatus(meta.status)) return;

    const view = parseHistory(await this.store.loadHistory(task.executionId));

    if (view.cancelRequested) {
      await this.store.enqueueWorkflow(task.executionId);
      return;
    }

    await this.store.appendEvents(task.executionId, [
      {
        type: "StepScheduled",
        stepId: task.stepId,
        stepName: task.stepName,
        attempt: task.attempt,
        timestamp: Date.now(),
      },
    ]);

    await this.store.enqueueStep({
      executionId: task.executionId,
      stepId: task.stepId,
      stepName: task.stepName,
      attempt: task.attempt,
    });
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
        await this.store.markInactive(executionId);
        continue;
      }

      if ((await this.store.getLease(executionId)) != null) continue;

      const view = parseHistory(await this.store.loadHistory(executionId));

      for (const [stepId, state] of view.steps) {
        if (state.status === "completed") continue;

        if (state.status === "failed") {
          if (state.retryable && state.attempt <= this.retries) {
            await this.store.scheduleTimer(Date.now(), {
              kind: "step-retry",
              executionId,
              stepId,
              stepName: state.stepName,
              attempt: state.attempt + 1,
            });
          }

          continue;
        }

        await this.store.enqueueStep({
          executionId,
          stepId,
          stepName: state.stepName,
          attempt: state.attempt,
        });
      }

      for (const [timerId, state] of view.timers) {
        if (state.status !== "started") continue;

        await this.store.scheduleTimer(Math.min(state.fireAt, Date.now()), {
          kind: "timer",
          executionId,
          timerId,
        });
      }

      await this.store.enqueueWorkflow(executionId);
    }
  }

  private startHeartbeat(executionId: string, token: string) {
    const interval = Math.max(50, Math.floor(this.lockTTL * HEARTBEAT_RATIO));

    return setInterval(() => {
      void (async () => {
        const [error, ok] = await mightThrow(
          this.store.extendLease(executionId, token, this.lockTTL),
        );

        if (error || !ok) {
          this.lostLeases.add(executionId);
          this.partitionSlots.delete(executionId);
          return;
        }

        const slot = this.partitionSlots.get(executionId);

        if (slot === undefined) return;

        const meta = await this.store.getMeta(executionId);

        if (!meta?.partitionKey) return;

        const refreshed = await this.store.refreshPartition(
          meta.partitionKey,
          slot,
          executionId,
          this.lockTTL,
        );

        if (!refreshed) this.partitionSlots.delete(executionId);
      })();
    }, interval);
  }

  private async clearExecutionLocalState(
    executionId: string,
    partitionKey: string,
    partitionSlot: number | undefined,
  ) {
    await this.store.markInactive(executionId);
    this.aborts.delete(executionId);

    if (!partitionKey) return;

    if (partitionSlot === undefined) return;

    await this.store.releasePartition(partitionKey, partitionSlot, executionId);
    this.partitionSlots.delete(executionId);
  }

  private async completeExecution(
    executionId: string,
    result: string,
    rawInput: string,
    partitionKey: string,
    partitionSlot: number | undefined,
  ) {
    await this.store.updateStatus(executionId, "completed", {
      result,
      completedAt: String(Date.now()),
      error: "",
    });

    await this.clearExecutionLocalState(
      executionId,
      partitionKey,
      partitionSlot,
    );

    const input = deserializeWith(
      rawInput,
      this.options.deserializeInput,
      "input",
    );

    await runHook(() =>
      this.options.hooks?.onComplete?.({
        executionId,
        input,
        result: deserializeWith(
          result,
          this.options.deserializeResult,
          "result",
        ),
      }),
    );
  }

  private async failExecution(
    executionId: string,
    error: string,
    partitionKey: string,
    partitionSlot: number | undefined,
  ) {
    await this.store.updateStatus(executionId, "failed", {
      error,
      failedAt: String(Date.now()),
    });

    await this.clearExecutionLocalState(
      executionId,
      partitionKey,
      partitionSlot,
    );
  }

  private async cancelExecution(
    executionId: string,
    rawInput: string,
    partitionKey: string,
    partitionSlot: number | undefined,
  ) {
    await this.store.updateStatus(executionId, "cancelled", {
      cancelledAt: String(Date.now()),
      error: "",
    });

    await this.clearExecutionLocalState(
      executionId,
      partitionKey,
      partitionSlot,
    );

    const input = deserializeWith(
      rawInput,
      this.options.deserializeInput,
      "input",
    );

    await runHook(() => this.options.hooks?.onCancel?.({ executionId, input }));
  }

  private async finalizeFromTerminal(
    executionId: string,
    terminal: NonNullable<ReturnType<typeof parseHistory>["terminal"]>,
    rawInput: string,
  ) {
    const slot = this.partitionSlots.get(executionId);
    const meta = await this.store.getMeta(executionId);
    const partitionKey = meta?.partitionKey ?? "";

    if (terminal.kind === "completed") {
      await this.completeExecution(
        executionId,
        terminal.result,
        rawInput,
        partitionKey,
        slot,
      );
      return;
    }

    if (terminal.kind === "failed") {
      await this.failExecution(executionId, terminal.error, partitionKey, slot);
      return;
    }

    await this.cancelExecution(executionId, rawInput, partitionKey, slot);
  }
}

import { mightThrow, mightThrowSync } from "../errors/index.js";
import { SerializationError, WorkflowBlocked } from "./errors.js";
import type { HistoryEvent, HistoryView } from "./history.js";
import type {
  DeserializeValue,
  SerializeValue,
  StepHandler,
  WorkflowHandlerContext,
  WorkflowOptions,
} from "./types.js";

const defaultSerialize = <T>(value: T) => {
  const raw = JSON.stringify(value);

  if (raw === undefined) return "null";

  return raw;
};

export const serializeWith = <T>(
  value: T,
  serialize: SerializeValue<T> | undefined,
  label: string,
) => {
  const fn = serialize ?? defaultSerialize<T>;
  const [error, raw] = mightThrowSync(() => fn(value));

  if (error) {
    throw new SerializationError(`Unable to serialize ${label}`);
  }

  if (typeof raw !== "string") {
    throw new SerializationError(`Unable to serialize ${label}`);
  }

  return raw;
};

export const deserializeWith = <T>(
  raw: string,
  deserialize: DeserializeValue<T> | undefined,
  label: string,
) => {
  const fn = deserialize ?? ((value: string) => JSON.parse(value) as T);
  const [error, value] = mightThrowSync(() => fn(raw));

  if (error) {
    throw new SerializationError(`Unable to deserialize ${label}`);
  }

  return value as T;
};

type ConsumedCommands = {
  steps: Set<string>;
  timers: Set<string>;
};

const createContext = <TInput, TResult>(
  options: WorkflowOptions<TInput, TResult>,
  view: HistoryView,
  executionId: string,
  signal: AbortSignal,
  now: number,
  events: HistoryEvent[],
  consumed: ConsumedCommands,
  onCapture?: (stepId: string, handler: StepHandler<TInput, unknown>) => void,
): WorkflowHandlerContext<TInput> => {
  const input = deserializeWith(view.input, options.deserializeInput, "input");

  let stepSeq = 0;
  let timerSeq = 0;

  return {
    input,
    executionId,
    signal,
    step: async (name, handler) => {
      const stepId = `a${stepSeq++}`;

      consumed.steps.add(stepId);
      onCapture?.(stepId, handler as StepHandler<TInput, unknown>);

      const state = view.steps.get(stepId);

      if (state && state.stepName !== name) {
        throw new Error(
          `nondeterminism: step ${stepId} expected "${state.stepName}", got "${name}"`,
        );
      }

      if (state?.status === "completed") {
        return deserializeWith(
          state.result,
          options.deserializeStepOutput,
          `step ${name}`,
        ) as never;
      }

      if (state?.status === "failed") {
        if (!state.retryable || state.attempt > (options.retries ?? 3)) {
          throw new Error(state.error);
        }
      }

      if (state) {
        throw new WorkflowBlocked("step");
      }

      events.push({
        type: "StepScheduled",
        stepId,
        stepName: name,
        attempt: 1,
        timestamp: now,
      });

      throw new WorkflowBlocked("step");
    },
    sleep: async (ms) => {
      if (!Number.isFinite(ms)) {
        throw new Error("sleep(ms) requires a non-negative finite number");
      }

      if (ms < 0) {
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

      if (state?.status === "started") {
        throw new WorkflowBlocked("timer");
      }

      events.push({
        type: "TimerStarted",
        timerId,
        fireAt: now + ms,
        timestamp: now,
      });

      throw new WorkflowBlocked("timer");
    },
  };
};

const assertHistoryConsumed = (
  view: HistoryView,
  consumed: ConsumedCommands,
) => {
  for (const stepId of view.steps.keys()) {
    if (consumed.steps.has(stepId)) continue;

    throw new Error(
      `nondeterminism: historical step ${stepId} was not replayed`,
    );
  }

  for (const timerId of view.timers.keys()) {
    if (consumed.timers.has(timerId)) continue;

    throw new Error(
      `nondeterminism: historical timer ${timerId} was not replayed`,
    );
  }
};

export const replayWorkflow = async <TInput, TResult>(
  options: WorkflowOptions<TInput, TResult>,
  view: HistoryView,
  executionId: string,
  signal: AbortSignal,
  isCancelRequested: () => boolean | Promise<boolean>,
) => {
  const events: HistoryEvent[] = [];
  const now = Date.now();

  if (view.terminal) {
    return events;
  }

  if (signal.aborted) {
    events.push({ type: "WorkflowCancelled", timestamp: now });
    return events;
  }

  if (view.cancelRequested) {
    events.push({ type: "WorkflowCancelled", timestamp: now });
    return events;
  }

  const consumed: ConsumedCommands = {
    steps: new Set(),
    timers: new Set(),
  };

  const ctx = createContext(
    options,
    view,
    executionId,
    signal,
    now,
    events,
    consumed,
  );

  const [handlerError, result] = await mightThrow(
    Promise.resolve(options.handler(ctx)),
  );

  if (handlerError) {
    if (handlerError instanceof WorkflowBlocked) {
      return events;
    }

    events.push({
      type: "WorkflowFailed",
      error: handlerError.message,
      timestamp: now,
    });
    return events;
  }

  if (signal.aborted) {
    events.push({ type: "WorkflowCancelled", timestamp: now });
    return events;
  }

  if (await isCancelRequested()) {
    events.push({ type: "WorkflowCancelled", timestamp: now });
    return events;
  }

  const [nondetError] = mightThrowSync(() =>
    assertHistoryConsumed(view, consumed),
  );

  if (nondetError) {
    events.push({
      type: "WorkflowFailed",
      error: nondetError.message,
      timestamp: now,
    });
    return events;
  }

  events.push({
    type: "WorkflowCompleted",
    result: serializeWith(result as TResult, options.serializeResult, "result"),
    timestamp: now,
  });

  return events;
};

export const captureStepHandler = async <TInput, TResult>(
  options: WorkflowOptions<TInput, TResult>,
  view: HistoryView,
  executionId: string,
  targetStepId: string,
) => {
  const box: { handler: StepHandler<TInput, unknown> | null } = {
    handler: null,
  };

  const ctx = createContext(
    options,
    view,
    executionId,
    new AbortController().signal,
    Date.now(),
    [],
    { steps: new Set(), timers: new Set() },
    (stepId, handler) => {
      if (stepId === targetStepId) {
        box.handler = handler;
      }
    },
  );

  await mightThrow(Promise.resolve(options.handler(ctx)));

  return box.handler;
};

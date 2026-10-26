import { mightThrowSync } from "../errors/index.js";
import { SerializationError } from "./errors.js";
import type {
  HistoryEvent,
  HistoryView,
  StepState,
  TimerState,
} from "./types.js";

export const isTerminalStatus = (status: string) => {
  if (status === "completed") return true;
  if (status === "failed") return true;
  if (status === "cancelled") return true;

  return false;
};

export const emptyHistoryView = (): HistoryView => ({
  events: [],
  input: "",
  partitionKey: "",
  steps: new Map<string, StepState>(),
  timers: new Map<string, TimerState>(),
  started: new Set<string>(),
  terminal: null,
  compensation: null,
});

// Applies one event to a view in place. parseHistory folds the stored list
// through this; the lease holder applies its own committed events with it
// instead of reloading history.
export const applyHistoryEvent = (view: HistoryView, event: HistoryEvent) => {
  const { steps, timers } = view;

  view.events.push(event);

  if (event.type === "WorkflowStarted") {
    view.input = event.input;
    view.partitionKey = event.partitionKey;
    return;
  }

  if (event.type === "StepScheduled") {
    steps.set(event.stepId, {
      status: "scheduled",
      stepName: event.stepName,
      attempt: event.attempt,
    });
    return;
  }

  if (event.type === "StepStarted") {
    const previous = steps.get(event.stepId);

    view.started.add(event.stepId);

    steps.set(event.stepId, {
      status: "started",
      stepName: previous?.stepName ?? "",
      attempt: event.attempt,
    });
    return;
  }

  if (event.type === "StepCompleted") {
    steps.set(event.stepId, {
      status: "completed",
      stepName: event.stepName,
      result: event.result,
      completedAt: event.timestamp,
    });
    return;
  }

  if (event.type === "StepFailed") {
    steps.set(event.stepId, {
      status: "failed",
      stepName: event.stepName,
      error: event.error,
      retryable: event.retryable,
      attempt: event.attempt,
      failedAt: event.timestamp,
    });
    return;
  }

  if (event.type === "TimerStarted") {
    timers.set(event.timerId, {
      status: "started",
      fireAt: event.fireAt,
      delayMs: event.fireAt - event.timestamp,
    });
    return;
  }

  if (event.type === "TimerFired") {
    const previous = timers.get(event.timerId);

    timers.set(event.timerId, {
      status: "fired",
      delayMs: previous?.delayMs ?? 0,
    });
    return;
  }

  if (event.type === "WorkflowCancelled") {
    view.terminal = { kind: "cancelled" };
    return;
  }

  if (event.type === "WorkflowCompleted") {
    view.terminal = { kind: "completed", result: event.result };
    return;
  }

  if (event.type === "WorkflowFailed") {
    view.terminal = { kind: "failed", error: event.error };
    return;
  }

  if (event.type === "WorkflowResumed") {
    view.terminal = null;
    return;
  }

  if (event.type === "CompensationStarted") {
    const stepIds = Array.isArray(event.stepIds) ? event.stepIds : [];

    view.compensation = {
      reason: event.reason,
      error: event.error,
      stepIds,
    };
  }
};

export const parseHistory = (rawEvents: string[]): HistoryView => {
  const view = emptyHistoryView();

  for (const raw of rawEvents) {
    const [error, event] = mightThrowSync(
      () => JSON.parse(raw) as HistoryEvent,
    );

    if (error) {
      throw new SerializationError("Unable to parse history event");
    }

    if (event === null || typeof event !== "object") {
      throw new SerializationError("Unable to parse history event");
    }

    applyHistoryEvent(view, event);
  }

  return view;
};

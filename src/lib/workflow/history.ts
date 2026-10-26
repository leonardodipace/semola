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
  steps: new Map<string, StepState>(),
  undos: new Map<string, StepState>(),
  timers: new Map<string, TimerState>(),
  started: new Set<string>(),
  terminal: null,
  compensation: null,
});

// History records the undo of forward step `a<N>` as step `u<N>`. This is the
// only place that id format is known: the view files undo steps under the
// forward step id they undo.
export const undoStepId = (stepId: string) => `u${stepId.slice(1)}`;

const stepSlot = (view: HistoryView, stepId: string) => {
  if (stepId.startsWith("u")) {
    return { states: view.undos, id: `a${stepId.slice(1)}`, undo: true };
  }

  return { states: view.steps, id: stepId, undo: false };
};

// Applies one event to a view in place. parseHistory folds the stored list
// through this; the lease holder applies its own committed events with it
// instead of reloading history.
export const applyHistoryEvent = (view: HistoryView, event: HistoryEvent) => {
  const { timers } = view;

  view.events.push(event);

  if (event.type === "StepScheduled") {
    const { states, id } = stepSlot(view, event.stepId);

    states.set(id, {
      status: "scheduled",
      stepName: event.stepName,
      attempt: event.attempt,
    });
    return;
  }

  if (event.type === "StepStarted") {
    const { states, id, undo } = stepSlot(view, event.stepId);
    const previous = states.get(id);

    if (!undo) view.started.add(id);

    states.set(id, {
      status: "started",
      stepName: previous?.stepName ?? "",
      attempt: event.attempt,
    });
    return;
  }

  if (event.type === "StepCompleted") {
    const { states, id } = stepSlot(view, event.stepId);

    states.set(id, {
      status: "completed",
      stepName: event.stepName,
      result: event.result,
      completedAt: event.timestamp,
    });
    return;
  }

  if (event.type === "StepFailed") {
    const { states, id } = stepSlot(view, event.stepId);

    states.set(id, {
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

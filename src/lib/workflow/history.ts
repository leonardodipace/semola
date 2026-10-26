import { SerializationError } from "./errors.js";
import { fromJson } from "./json.js";
import type {
  HistoryEvent,
  HistoryView,
  StepState,
  TimerState,
} from "./types.js";

export const emptyHistoryView = (): HistoryView => ({
  events: [],
  steps: new Map<string, StepState>(),
  undos: new Map<string, StepState>(),
  timers: new Map<string, TimerState>(),
  started: new Set<string>(),
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

  if (event.type === "StepStarted") {
    const { states, id, undo } = stepSlot(view, event.stepId);

    if (!undo) view.started.add(id);

    states.set(id, {
      status: "started",
      stepName: event.stepName,
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

  // Failed forward steps run again from attempt 1. They stay in the view
  // under their name, so replay still checks it.
  if (event.type === "WorkflowResumed") {
    for (const [id, state] of view.steps) {
      if (state.status !== "failed") continue;

      view.steps.set(id, {
        status: "started",
        stepName: state.stepName,
        attempt: 1,
      });
    }
    return;
  }

  if (event.type === "CompensationStarted") {
    view.compensation = {
      reason: event.reason,
      error: event.error,
      stepIds: event.stepIds,
    };
  }
};

export const parseHistory = (rawEvents: string[]): HistoryView => {
  const view = emptyHistoryView();

  for (const raw of rawEvents) {
    const event = fromJson<HistoryEvent>(raw, "history event");

    if (event === null || typeof event !== "object") {
      throw new SerializationError("Unable to deserialize history event");
    }

    applyHistoryEvent(view, event);
  }

  return view;
};

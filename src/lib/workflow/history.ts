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

export const parseHistory = (rawEvents: string[]): HistoryView => {
  const events: HistoryEvent[] = [];
  const steps = new Map<string, StepState>();
  const timers = new Map<string, TimerState>();

  let input = "";
  let partitionKey = "";
  let cancelRequested = false;
  let terminal: HistoryView["terminal"] = null;

  for (const raw of rawEvents) {
    const [error, event] = mightThrowSync(
      () => JSON.parse(raw) as HistoryEvent,
    );

    if (error) {
      throw new SerializationError("Unable to parse history event");
    }

    events.push(event);

    if (event.type === "WorkflowStarted") {
      input = event.input;
      partitionKey = event.partitionKey;
      continue;
    }

    if (event.type === "StepScheduled") {
      steps.set(event.stepId, {
        status: "scheduled",
        stepName: event.stepName,
        attempt: event.attempt,
      });
      continue;
    }

    if (event.type === "StepStarted") {
      const previous = steps.get(event.stepId);

      steps.set(event.stepId, {
        status: "started",
        stepName: previous?.stepName ?? "",
        attempt: event.attempt,
      });
      continue;
    }

    if (event.type === "StepCompleted") {
      steps.set(event.stepId, {
        status: "completed",
        stepName: event.stepName,
        result: event.result,
        completedAt: event.timestamp,
      });
      continue;
    }

    if (event.type === "StepFailed") {
      steps.set(event.stepId, {
        status: "failed",
        stepName: event.stepName,
        error: event.error,
        retryable: event.retryable,
        attempt: event.attempt,
      });
      continue;
    }

    if (event.type === "TimerStarted") {
      timers.set(event.timerId, {
        status: "started",
        fireAt: event.fireAt,
        delayMs: event.fireAt - event.timestamp,
      });
      continue;
    }

    if (event.type === "TimerFired") {
      const previous = timers.get(event.timerId);

      timers.set(event.timerId, {
        status: "fired",
        delayMs: previous?.delayMs ?? 0,
      });
      continue;
    }

    if (event.type === "WorkflowCancelRequested") {
      cancelRequested = true;
      continue;
    }

    if (event.type === "WorkflowCancelled") {
      terminal = { kind: "cancelled" };
      continue;
    }

    if (event.type === "WorkflowCompleted") {
      terminal = { kind: "completed", result: event.result };
      continue;
    }

    if (event.type === "WorkflowFailed") {
      terminal = { kind: "failed", error: event.error };
      continue;
    }

    if (event.type === "WorkflowResumed") {
      terminal = null;
      cancelRequested = false;
    }
  }

  return {
    events,
    input,
    partitionKey,
    steps,
    timers,
    cancelRequested,
    terminal,
  };
};

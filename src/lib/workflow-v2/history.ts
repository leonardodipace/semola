export type HistoryEvent =
  | {
      type: "WorkflowExecutionStarted";
      input: string;
      partitionKey: string;
      timestamp: number;
    }
  | {
      type: "ActivityTaskScheduled";
      activityId: string;
      stepName: string;
      attempt: number;
      timestamp: number;
    }
  | {
      type: "ActivityTaskStarted";
      activityId: string;
      attempt: number;
      timestamp: number;
    }
  | {
      type: "ActivityTaskCompleted";
      activityId: string;
      stepName: string;
      result: string;
      timestamp: number;
    }
  | {
      type: "ActivityTaskFailed";
      activityId: string;
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
      type: "WorkflowExecutionCancelRequested";
      timestamp: number;
    }
  | {
      type: "WorkflowExecutionCancelled";
      timestamp: number;
    }
  | {
      type: "WorkflowExecutionCompleted";
      result: string;
      timestamp: number;
    }
  | {
      type: "WorkflowExecutionFailed";
      error: string;
      timestamp: number;
    }
  | {
      type: "WorkflowExecutionResumed";
      timestamp: number;
    };

export type ActivityState =
  | {
      status: "scheduled" | "started";
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
    };

export type TimerState =
  | { status: "started"; fireAt: number }
  | { status: "fired" };

export type HistoryView = {
  events: HistoryEvent[];
  input: string;
  partitionKey: string;
  activities: Map<string, ActivityState>;
  timers: Map<string, TimerState>;
  cancelRequested: boolean;
  terminal:
    | { kind: "completed"; result: string }
    | { kind: "failed"; error: string }
    | { kind: "cancelled" }
    | null;
};

export const isTerminalStatus = (status: string) => {
  if (status === "completed") return true;
  if (status === "failed") return true;
  if (status === "cancelled") return true;

  return false;
};

export const parseHistory = (rawEvents: string[]): HistoryView => {
  const events: HistoryEvent[] = [];
  const activities = new Map<string, ActivityState>();
  const timers = new Map<string, TimerState>();

  let input = "";
  let partitionKey = "";
  let cancelRequested = false;
  let terminal: HistoryView["terminal"] = null;

  for (const raw of rawEvents) {
    const event = JSON.parse(raw) as HistoryEvent;
    events.push(event);

    if (event.type === "WorkflowExecutionStarted") {
      input = event.input;
      partitionKey = event.partitionKey;
      continue;
    }

    if (event.type === "ActivityTaskScheduled") {
      activities.set(event.activityId, {
        status: "scheduled",
        stepName: event.stepName,
        attempt: event.attempt,
      });
      continue;
    }

    if (event.type === "ActivityTaskStarted") {
      const previous = activities.get(event.activityId);

      activities.set(event.activityId, {
        status: "started",
        stepName: previous?.stepName ?? "",
        attempt: event.attempt,
      });
      continue;
    }

    if (event.type === "ActivityTaskCompleted") {
      activities.set(event.activityId, {
        status: "completed",
        stepName: event.stepName,
        result: event.result,
        completedAt: event.timestamp,
      });
      continue;
    }

    if (event.type === "ActivityTaskFailed") {
      activities.set(event.activityId, {
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
      });
      continue;
    }

    if (event.type === "TimerFired") {
      timers.set(event.timerId, { status: "fired" });
      continue;
    }

    if (event.type === "WorkflowExecutionCancelRequested") {
      cancelRequested = true;
      continue;
    }

    if (event.type === "WorkflowExecutionCancelled") {
      terminal = { kind: "cancelled" };
      continue;
    }

    if (event.type === "WorkflowExecutionCompleted") {
      terminal = { kind: "completed", result: event.result };
      continue;
    }

    if (event.type === "WorkflowExecutionFailed") {
      terminal = { kind: "failed", error: event.error };
      continue;
    }

    if (event.type === "WorkflowExecutionResumed") {
      terminal = null;
      cancelRequested = false;
    }
  }

  return {
    events,
    input,
    partitionKey,
    activities,
    timers,
    cancelRequested,
    terminal,
  };
};

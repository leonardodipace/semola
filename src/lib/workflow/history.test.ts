import { describe, expect, test } from "bun:test";
import { SerializationError } from "./errors.js";
import { parseHistory } from "./history.js";

describe("parseHistory", () => {
  test("throws SerializationError for corrupt event json", () => {
    expect(() => parseHistory(["not-json"])).toThrow(SerializationError);
  });

  test("roundtrips a basic event sequence", () => {
    const now = 1_700_000_000_000;

    const view = parseHistory([
      JSON.stringify({
        type: "WorkflowStarted",
        input: '{"x":1}',
        partitionKey: "p1",
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepScheduled",
        stepId: "s1",
        stepName: "work",
        attempt: 1,
        timestamp: now + 1,
      }),
      JSON.stringify({
        type: "StepCompleted",
        stepId: "s1",
        stepName: "work",
        result: "42",
        timestamp: now + 2,
      }),
      JSON.stringify({
        type: "WorkflowCompleted",
        result: "42",
        timestamp: now + 3,
      }),
    ]);

    expect(view.input).toBe('{"x":1}');
    expect(view.partitionKey).toBe("p1");
    expect(view.steps.get("s1")).toEqual({
      status: "completed",
      stepName: "work",
      result: "42",
      completedAt: now + 2,
    });
    expect(view.terminal).toEqual({ kind: "completed", result: "42" });
  });

  test("WorkflowResumed clears terminal and cancelRequested", () => {
    const now = 1_700_000_000_000;

    const view = parseHistory([
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "WorkflowCancelRequested",
        timestamp: now + 1,
      }),
      JSON.stringify({
        type: "WorkflowCancelled",
        timestamp: now + 2,
      }),
      JSON.stringify({
        type: "WorkflowResumed",
        timestamp: now + 3,
      }),
    ]);

    expect(view.cancelRequested).toBe(false);
    expect(view.terminal).toBeNull();
  });

  test("TimerFired inherits delayMs and StepStarted inherits stepName", () => {
    const now = 1_700_000_000_000;
    const delayMs = 5_000;

    const view = parseHistory([
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepScheduled",
        stepId: "s1",
        stepName: "work",
        attempt: 1,
        timestamp: now + 1,
      }),
      JSON.stringify({
        type: "StepStarted",
        stepId: "s1",
        attempt: 1,
        timestamp: now + 2,
      }),
      JSON.stringify({
        type: "TimerStarted",
        timerId: "t1",
        fireAt: now + delayMs,
        timestamp: now,
      }),
      JSON.stringify({
        type: "TimerFired",
        timerId: "t1",
        timestamp: now + delayMs,
      }),
    ]);

    expect(view.steps.get("s1")).toEqual({
      status: "started",
      stepName: "work",
      attempt: 1,
    });
    expect(view.timers.get("t1")).toEqual({
      status: "fired",
      delayMs,
    });
  });
});

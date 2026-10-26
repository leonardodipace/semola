import { describe, expect, test } from "bun:test";
import { SerializationError } from "./errors.js";
import {
  applyHistoryEvent,
  emptyHistoryView,
  parseHistory,
} from "./history.js";
import type { HistoryEvent } from "./types.js";

describe("parseHistory", () => {
  test("throws SerializationError for corrupt event json", () => {
    expect(() => parseHistory(["not-json"])).toThrow(SerializationError);
  });

  test("throws SerializationError for JSON null event", () => {
    expect(() => parseHistory(["null"])).toThrow(SerializationError);
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

  test("WorkflowResumed clears terminal", () => {
    const now = 1_700_000_000_000;

    const view = parseHistory([
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "WorkflowFailed",
        error: "boom",
        timestamp: now + 2,
      }),
      JSON.stringify({
        type: "WorkflowResumed",
        timestamp: now + 3,
      }),
    ]);

    expect(view.terminal).toBeNull();
  });

  test("applying events one by one matches parsing the stored list", () => {
    const now = 1_700_000_000_000;
    const events: HistoryEvent[] = [
      {
        type: "WorkflowStarted",
        input: '{"a":1}',
        partitionKey: "p",
        timestamp: now,
      },
      {
        type: "StepScheduled",
        stepId: "a0",
        stepName: "one",
        attempt: 1,
        timestamp: now,
      },
      { type: "StepStarted", stepId: "a0", attempt: 1, timestamp: now },
      {
        type: "StepCompleted",
        stepId: "a0",
        stepName: "one",
        result: "1",
        timestamp: now,
      },
      { type: "TimerStarted", timerId: "t0", fireAt: now + 50, timestamp: now },
      { type: "TimerFired", timerId: "t0", timestamp: now + 50 },
      {
        type: "CompensationStarted",
        reason: "failed",
        error: "boom",
        stepIds: ["a0"],
        timestamp: now + 60,
      },
      {
        type: "CompensationFailed",
        stepId: "a0",
        stepName: "one",
        error: "x",
        retryable: true,
        attempt: 1,
        timestamp: now + 61,
      },
      {
        type: "CompensationCompleted",
        stepId: "a0",
        stepName: "one",
        timestamp: now + 62,
      },
      { type: "WorkflowFailed", error: "boom", timestamp: now + 63 },
    ];

    const incremental = emptyHistoryView();

    for (const event of events) applyHistoryEvent(incremental, event);

    const parsed = parseHistory(events.map((event) => JSON.stringify(event)));

    expect(incremental).toEqual(parsed);
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

  test("compensation events do not set terminal", () => {
    const now = 1_700_000_000_000;

    const view = parseHistory([
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepCompleted",
        stepId: "a0",
        stepName: "create-account",
        result: '"acc-1"',
        timestamp: now + 1,
      }),
      JSON.stringify({
        type: "CompensationStarted",
        reason: "failed",
        error: "provision failed",
        stepIds: ["a0"],
        timestamp: now + 2,
      }),
      JSON.stringify({
        type: "CompensationCompleted",
        stepId: "a0",
        stepName: "create-account",
        timestamp: now + 3,
      }),
    ]);

    expect(view.terminal).toBeNull();
    expect(view.compensation?.reason).toBe("failed");
    expect(view.compensation?.error).toBe("provision failed");
    expect(view.compensation?.steps.get("a0")).toEqual({
      status: "completed",
      stepName: "create-account",
    });
  });

  test("CompensationStarted without stepIds normalizes to empty list", () => {
    const now = 1_700_000_000_000;

    const view = parseHistory([
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "CompensationStarted",
        reason: "failed",
        error: "boom",
        timestamp: now + 1,
      }),
    ]);

    expect(view.compensation?.stepIds).toEqual([]);
  });

  test("compensation failed updates step state", () => {
    const now = 1_700_000_000_000;

    const view = parseHistory([
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "CompensationStarted",
        reason: "cancelled",
        error: null,
        stepIds: ["a0"],
        timestamp: now + 1,
      }),
      JSON.stringify({
        type: "CompensationFailed",
        stepId: "a0",
        stepName: "create-account",
        error: "undo failed",
        retryable: true,
        attempt: 1,
        timestamp: now + 2,
      }),
    ]);

    expect(view.compensation?.reason).toBe("cancelled");
    expect(view.compensation?.steps.get("a0")).toEqual({
      status: "failed",
      stepName: "create-account",
      error: "undo failed",
      retryable: true,
      attempt: 1,
      failedAt: now + 2,
    });
  });
});

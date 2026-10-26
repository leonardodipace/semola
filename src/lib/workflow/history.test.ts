import { describe, expect, test } from "bun:test";
import { SerializationError } from "./errors.js";
import {
  applyHistoryEvent,
  emptyHistoryView,
  parseHistory,
  undoStepId,
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
        type: "StepStarted",
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

    expect(view.steps.get("s1")).toEqual({
      status: "completed",
      stepName: "work",
      result: "42",
      completedAt: now + 2,
    });
    expect(view.terminal).toEqual({ kind: "completed", result: "42" });
  });

  test("WorkflowResumed clears terminal and resets failed steps to attempt 1", () => {
    const now = 1_700_000_000_000;
    const events: HistoryEvent[] = [
      { type: "WorkflowStarted", timestamp: now },
      {
        type: "StepStarted",
        stepId: "a0",
        stepName: "one",
        attempt: 1,
        timestamp: now,
      },
      {
        type: "StepCompleted",
        stepId: "a0",
        stepName: "one",
        result: "1",
        timestamp: now,
      },
      {
        type: "StepStarted",
        stepId: "a1",
        stepName: "two",
        attempt: 3,
        timestamp: now + 1,
      },
      {
        type: "StepFailed",
        stepId: "a1",
        stepName: "two",
        error: "boom",
        retryable: true,
        attempt: 3,
        timestamp: now + 1,
      },
      { type: "WorkflowFailed", error: "boom", timestamp: now + 2 },
      { type: "WorkflowResumed", timestamp: now + 3 },
    ];

    const view = parseHistory(events.map((event) => JSON.stringify(event)));

    expect(view.terminal).toBeNull();
    expect(view.steps.get("a0")?.status).toBe("completed");
    expect(view.steps.get("a1")).toEqual({
      status: "started",
      stepName: "two",
      attempt: 1,
    });
    expect([...view.started]).toEqual(["a0", "a1"]);
  });

  test("applying events one by one matches parsing the stored list", () => {
    const now = 1_700_000_000_000;
    const events: HistoryEvent[] = [
      {
        type: "WorkflowStarted",
        timestamp: now,
      },
      {
        type: "StepStarted",
        stepId: "a0",
        stepName: "one",
        attempt: 1,
        timestamp: now,
      },
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
        type: "StepStarted",
        stepId: "u0",
        stepName: "undo:one",
        attempt: 1,
        timestamp: now + 61,
      },
      {
        type: "StepCompleted",
        stepId: "u0",
        stepName: "undo:one",
        result: "null",
        timestamp: now + 62,
      },
      { type: "WorkflowFailed", error: "boom", timestamp: now + 63 },
    ];

    const incremental = emptyHistoryView();

    for (const event of events) applyHistoryEvent(incremental, event);

    const parsed = parseHistory(events.map((event) => JSON.stringify(event)));

    expect(incremental).toEqual(parsed);
  });

  test("undo step events are filed under the forward step they undo", () => {
    const now = 1_700_000_000_000;

    const view = parseHistory(
      [
        { type: "StepStarted", stepId: "a3", stepName: "one", attempt: 1 },
        { type: "StepFailed", stepId: "a3", stepName: "one", error: "x" },
        { type: "StepStarted", stepId: "u3", stepName: "undo:one", attempt: 1 },
        { type: "StepCompleted", stepId: "u3", stepName: "undo:one" },
      ].map((event) =>
        JSON.stringify({
          retryable: false,
          result: "null",
          ...event,
          timestamp: now,
        }),
      ),
    );

    expect([...view.steps.keys()]).toEqual(["a3"]);
    expect(view.steps.get("a3")?.status).toBe("failed");
    expect([...view.undos.keys()]).toEqual(["a3"]);
    expect(view.undos.get("a3")?.status).toBe("completed");
    expect([...view.started]).toEqual(["a3"]);
    expect(undoStepId("a3")).toBe("u3");
  });

  test("TimerFired inherits delayMs", () => {
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

    expect(view.timers.get("t1")).toEqual({
      status: "fired",
      delayMs,
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
});

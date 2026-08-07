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
});

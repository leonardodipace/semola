import { describe, expect, test } from "bun:test";
import { defineWorkflow } from "./index.js";

class MockRedisClient {
  private hashes = new Map<string, Map<string, string>>();
  private strings = new Map<string, string>();
  private failCommands = new Set<string>();
  private hsetCallsBeforeFail: number | null = null;

  public setCommandFailure(command: "hset" | "hget" | "set" | "get" | "del") {
    this.failCommands.add(command);
  }

  public failHsetAfterNCalls(n: number) {
    this.hsetCallsBeforeFail = n;
  }

  public seedHashField(key: string, field: string, value: string) {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }

    this.hashes.get(key)?.set(field, value);
  }

  public async hset(key: string, field: string, value: string) {
    if (this.failCommands.has("hset")) {
      throw new Error("hset failed");
    }

    if (this.hsetCallsBeforeFail !== null) {
      if (this.hsetCallsBeforeFail <= 0) {
        throw new Error("hset failed");
      }

      this.hsetCallsBeforeFail--;
    }

    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }

    const hash = this.hashes.get(key);

    if (!hash) {
      return 0;
    }

    hash.set(field, value);
    return 1;
  }

  public async hget(key: string, field: string) {
    if (this.failCommands.has("hget")) {
      throw new Error("hget failed");
    }

    const hash = this.hashes.get(key);

    if (!hash) {
      return null;
    }

    return hash.get(field) ?? null;
  }

  public async set(key: string, value: string, ...args: unknown[]) {
    if (this.failCommands.has("set")) {
      throw new Error("set failed");
    }

    let nx = false;
    let xx = false;

    for (const arg of args) {
      if (arg === "NX") {
        nx = true;
      }

      if (arg === "XX") {
        xx = true;
      }
    }

    const exists = this.strings.has(key);

    if (nx && exists) {
      return null;
    }

    if (xx && !exists) {
      return null;
    }

    this.strings.set(key, value);
    return "OK";
  }

  public async get(key: string) {
    if (this.failCommands.has("get")) {
      throw new Error("get failed");
    }

    return this.strings.get(key) ?? null;
  }

  public async del(key: string) {
    if (this.failCommands.has("del")) {
      throw new Error("del failed");
    }

    let count = 0;

    if (this.strings.delete(key)) {
      count++;
    }

    if (this.hashes.delete(key)) {
      count++;
    }

    return count;
  }
}

const createRedis = () => {
  return new MockRedisClient() as MockRedisClient & Bun.RedisClient;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createWorkflowWithEchoResult = (
  name: string,
  redis: Bun.RedisClient,
  callCounter?: { value: number },
) => {
  return defineWorkflow<{ id: number }, string>({
    name,
    redis,
    handler: async ({ input, step }) => {
      if (callCounter) {
        callCounter.value++;
      }

      const value = await step("echo", async () => {
        return `echo:${input.id}`;
      });

      return value;
    },
  });
};

describe("workflow", () => {
  test("runs workflow and stores result", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "onboard",
      redis,
      handler: async ({ input, step }) => {
        const user = await step("get-user", async () => {
          return { id: input.id, email: "user@example.com" };
        });

        await step("send-email", async () => {
          return `sent:${user.email}`;
        });

        return "done";
      },
    });

    const [error, result] = await workflow.run({ id: 1 });

    expect(error).toBeNull();
    expect(result).toBe("done");
  });

  test("returns not found on unknown execution", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "missing",
      redis,
      handler: async () => "ok",
    });

    const [error, execution] = await workflow.get("unknown");

    expect(error).toEqual({
      type: "WorkflowNotFoundError",
      message: "Workflow execution unknown not found",
    });
    expect(execution).toBeNull();
  });

  test("rejects duplicate execution ids", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "dupe",
      redis,
      handler: async () => "ok",
    });

    const [firstError, firstStart] = await workflow.start(
      { id: 1 },
      { executionId: "exec-1" },
    );

    const [secondError, secondStart] = await workflow.start(
      { id: 2 },
      { executionId: "exec-1" },
    );

    expect(firstError).toBeNull();
    expect(firstStart?.status).toBe("completed");
    expect(secondError).toEqual({
      type: "WorkflowStateError",
      message: "Workflow execution exec-1 already exists",
    });
    expect(secondStart).toBeNull();
  });

  test("resumes from next step after failure", async () => {
    const redis = createRedis();
    const executedSteps: string[] = [];

    let shouldFail = true;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "resume",
      redis,
      handler: async ({ input, step }) => {
        await step("step-1", async () => {
          executedSteps.push(`step-1:${input.id}`);
          return "ok";
        });

        await step("step-2", async () => {
          executedSteps.push(`step-2:${input.id}`);

          if (shouldFail) {
            shouldFail = false;
            throw new Error("crash");
          }

          return "ok";
        });

        return "done";
      },
    });

    const [startError] = await workflow.start(
      { id: 10 },
      { executionId: "exec-1" },
    );

    expect(startError).not.toBeNull();

    const [resumeError, resumeData] = await workflow.resume("exec-1");

    expect(resumeError).toBeNull();
    expect(resumeData?.status).toBe("completed");
    expect(executedSteps).toEqual(["step-1:10", "step-2:10", "step-2:10"]);
  });

  test("returns completed immediately when resuming completed execution", async () => {
    const redis = createRedis();
    let handlerCalls = 0;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "already-complete",
      redis,
      handler: async () => {
        handlerCalls++;
        return "done";
      },
    });

    await workflow.start({ id: 1 }, { executionId: "complete-1" });
    const [resumeError, resumeData] = await workflow.resume("complete-1");

    expect(resumeError).toBeNull();
    expect(resumeData?.status).toBe("completed");
    expect(handlerCalls).toBe(1);
  });

  test("supports cancellation", async () => {
    const redis = createRedis();
    let shouldFail = true;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "cancel",
      redis,
      handler: async ({ step }) => {
        await step("first", async () => "ok");

        await step("second", async () => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error("boom");
          }

          return "ok";
        });

        return "done";
      },
    });

    await workflow.start({ id: 1 }, { executionId: "cancel-1" });

    const [cancelError] = await workflow.cancel("cancel-1");
    const [resumeError, resumeData] = await workflow.resume("cancel-1");

    expect(cancelError).toBeNull();
    expect(resumeError).toBeNull();
    expect(resumeData?.status).toBe("cancelled");
  });

  test("rejects cancel for completed workflow", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "cancel-complete",
      redis,
      handler: async () => "done",
    });

    await workflow.start({ id: 1 }, { executionId: "done-1" });

    const [cancelError, cancelData] = await workflow.cancel("done-1");

    expect(cancelError).toEqual({
      type: "WorkflowStateError",
      message: "Workflow execution done-1 is already completed",
    });
    expect(cancelData).toBeNull();
  });

  test("fails with lock error when resumed while execution is running", async () => {
    const redis = createRedis();
    let release = false;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "lock",
      redis,
      handler: async ({ step }) => {
        await step("wait", async () => {
          while (!release) {
            await sleep(5);
          }

          return "ok";
        });

        return "done";
      },
    });

    const startPromise = workflow.start({ id: 1 }, { executionId: "lock-1" });

    await sleep(15);

    const [resumeError, resumeData] = await workflow.resume("lock-1");

    expect(resumeError).toEqual({
      type: "WorkflowLockError",
      message: "Workflow execution lock-1 is already running",
    });
    expect(resumeData).toBeNull();

    release = true;

    const [startError, startData] = await startPromise;

    expect(startError).toBeNull();
    expect(startData?.status).toBe("completed");
  });

  test("uses custom input and result serializers", async () => {
    const redis = createRedis();
    let serializedInputCalled = 0;
    let deserializedInputCalled = 0;
    let serializedResultCalled = 0;
    let deserializedResultCalled = 0;

    const workflow = defineWorkflow<{ id: number }, { ok: boolean }>({
      name: "serializers",
      redis,
      serializeInput: (value) => {
        serializedInputCalled++;
        return `in:${value.id}`;
      },
      deserializeInput: (raw) => {
        deserializedInputCalled++;
        const id = Number(raw.replace("in:", ""));
        return { id };
      },
      serializeResult: (value) => {
        serializedResultCalled++;
        return `out:${value.ok ? "1" : "0"}`;
      },
      deserializeResult: (raw) => {
        deserializedResultCalled++;
        return { ok: raw === "out:1" };
      },
      handler: async ({ input }) => {
        return { ok: input.id === 7 };
      },
    });

    const [runError, runData] = await workflow.run(
      { id: 7 },
      { executionId: "ser-1" },
    );

    expect(runError).toBeNull();
    expect(runData).toEqual({ ok: true });
    expect(serializedInputCalled).toBe(1);
    expect(deserializedInputCalled).toBe(1);
    expect(serializedResultCalled).toBe(1);
    expect(deserializedResultCalled).toBe(1);
  });

  test("returns workflow serialization error when input serializer throws", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "serialize-input-error",
      redis,
      serializeInput: () => {
        throw new Error("cannot serialize");
      },
      handler: async () => "ok",
    });

    const [startError, startData] = await workflow.start({ id: 1 });

    expect(startError?.type).toBe("WorkflowSerializationError");
    expect(
      startError?.message.includes("Unable to serialize workflow input for"),
    ).toBe(true);
    expect(startData).toBeNull();
  });

  test("returns workflow error when redis read fails", async () => {
    const redis = createRedis() as MockRedisClient & Bun.RedisClient;
    redis.setCommandFailure("hget");

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "redis-fail",
      redis,
      handler: async () => "ok",
    });

    const [error, data] = await workflow.get("any");

    expect(error).toEqual({
      type: "WorkflowError",
      message: "Unable to read status for execution any",
    });
    expect(data).toBeNull();
  });

  test("returns state error when step index is invalid", async () => {
    const redis = createRedis() as MockRedisClient & Bun.RedisClient;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "invalid-steps",
      redis,
      handler: async () => "ok",
    });

    await workflow.start({ id: 1 }, { executionId: "bad-steps-1" });

    redis.seedHashField(
      "workflow:invalid-steps:execution:bad-steps-1:meta",
      "steps",
      "{not-json}",
    );

    const [error, data] = await workflow.get("bad-steps-1");

    expect(error).toEqual({
      type: "WorkflowStateError",
      message: "Invalid step index for execution bad-steps-1",
    });
    expect(data).toBeNull();
  });

  test("get returns completed steps with timestamps", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "snapshots",
      redis,
      handler: async ({ step }) => {
        await step("one", async () => "a");
        await step("two", async () => "b");
        return "done";
      },
    });

    await workflow.start({ id: 1 }, { executionId: "snap-1" });

    const [error, execution] = await workflow.get("snap-1");

    expect(error).toBeNull();
    expect(execution?.steps.length).toBe(2);
    expect(execution?.steps[0]?.name).toBe("one");
    expect(execution?.steps[1]?.name).toBe("two");
    expect(typeof execution?.steps[0]?.completedAt).toBe("number");
    expect(typeof execution?.steps[1]?.completedAt).toBe("number");
  });

  describe("run matrix", () => {
    for (let i = 1; i <= 20; i++) {
      test(`runs workflow with id ${i}`, async () => {
        const redis = createRedis();
        const workflow = createWorkflowWithEchoResult(`run-matrix-${i}`, redis);

        const [error, result] = await workflow.run(
          { id: i },
          { executionId: `run-matrix-exec-${i}` },
        );

        expect(error).toBeNull();
        expect(result).toBe(`echo:${i}`);
      });
    }
  });

  describe("resume matrix", () => {
    for (let i = 1; i <= 15; i++) {
      test(`does not re-run completed execution ${i}`, async () => {
        const redis = createRedis();
        const calls = { value: 0 };
        const workflow = createWorkflowWithEchoResult(
          `resume-matrix-${i}`,
          redis,
          calls,
        );

        const executionId = `resume-matrix-exec-${i}`;

        await workflow.start({ id: i }, { executionId });
        const [resumeError, resumeData] = await workflow.resume(executionId);
        const [getError, execution] = await workflow.get(executionId);

        expect(resumeError).toBeNull();
        expect(resumeData?.status).toBe("completed");
        expect(getError).toBeNull();
        expect(execution?.result).toBe(`echo:${i}`);
        expect(calls.value).toBe(1);
      });
    }
  });

  describe("duplicate matrix", () => {
    for (let i = 1; i <= 10; i++) {
      test(`rejects duplicate execution id case ${i}`, async () => {
        const redis = createRedis();
        const workflow = createWorkflowWithEchoResult(
          `dupe-matrix-${i}`,
          redis,
        );
        const executionId = `dupe-matrix-exec-${i}`;

        const [firstError] = await workflow.start({ id: i }, { executionId });
        const [secondError, secondData] = await workflow.start(
          { id: i + 100 },
          { executionId },
        );

        expect(firstError).toBeNull();
        expect(secondError?.type).toBe("WorkflowStateError");
        expect(secondData).toBeNull();
      });
    }
  });

  describe("invalid status matrix", () => {
    const invalidStatuses = [
      "RUNNING",
      "unknown",
      "",
      "123",
      "paused",
      "complete",
    ];

    for (const status of invalidStatuses) {
      test(`fails on invalid stored status '${status}'`, async () => {
        const redis = createRedis() as MockRedisClient & Bun.RedisClient;
        const workflow = createWorkflowWithEchoResult(
          `invalid-status-${status || "empty"}`,
          redis,
        );

        const executionId = `invalid-status-exec-${status || "empty"}`;
        const metaKey = `workflow:invalid-status-${status || "empty"}:execution:${executionId}:meta`;

        await workflow.start({ id: 1 }, { executionId });
        redis.seedHashField(metaKey, "status", status);

        const [error, data] = await workflow.get(executionId);

        if (status.length === 0) {
          expect(error).toEqual({
            type: "WorkflowNotFoundError",
            message: `Workflow execution ${executionId} not found`,
          });
        } else {
          expect(error?.type).toBe("WorkflowStateError");
          expect(error?.message).toBe(
            `Workflow execution ${executionId} has invalid status ${status}`,
          );
        }

        expect(data).toBeNull();
      });
    }
  });

  describe("timestamp validation matrix", () => {
    const fields = ["completedAt", "failedAt", "cancelledAt"] as const;

    for (const field of fields) {
      test(`fails when ${field} is not numeric`, async () => {
        const redis = createRedis() as MockRedisClient & Bun.RedisClient;
        const workflow = createWorkflowWithEchoResult(`bad-${field}`, redis);

        const executionId = `bad-${field}-exec`;
        const metaKey = `workflow:bad-${field}:execution:${executionId}:meta`;

        await workflow.start({ id: 1 }, { executionId });
        redis.seedHashField(metaKey, field, "abc");

        const [error, data] = await workflow.get(executionId);

        expect(error).toEqual({
          type: "WorkflowStateError",
          message: `Invalid ${field} value for execution ${executionId}`,
        });
        expect(data).toBeNull();
      });
    }
  });

  describe("step snapshot validation matrix", () => {
    const payloads = [
      "{not-json}",
      JSON.stringify({ output: JSON.stringify({ value: "ok" }) }),
      JSON.stringify({
        output: JSON.stringify({ value: "ok" }),
        completedAt: "bad",
      }),
      JSON.stringify({
        output: JSON.stringify({ value: "ok" }),
        completedAt: null,
      }),
    ];

    for (let i = 0; i < payloads.length; i++) {
      test(`fails for malformed step payload variant ${i + 1}`, async () => {
        const redis = createRedis() as MockRedisClient & Bun.RedisClient;

        const workflow = defineWorkflow<{ id: number }, string>({
          name: `bad-step-payload-${i + 1}`,
          redis,
          handler: async ({ step }) => {
            await step("one", async () => "ok");
            return "done";
          },
        });

        const executionId = `bad-step-payload-exec-${i + 1}`;
        const metaKey = `workflow:bad-step-payload-${i + 1}:execution:${executionId}:meta`;
        const stepsKey = `workflow:bad-step-payload-${i + 1}:execution:${executionId}:steps`;

        await workflow.start({ id: 1 }, { executionId });

        redis.seedHashField(metaKey, "steps", JSON.stringify(["one"]));
        redis.seedHashField(stepsKey, "one", payloads[i] ?? "");

        const [error, data] = await workflow.get(executionId);

        expect(error?.type).toBe("WorkflowStateError");
        expect(error?.message).toBe(
          `Invalid step payload for one in execution ${executionId}`,
        );
        expect(data).toBeNull();
      });
    }
  });

  describe("redis write failure matrix", () => {
    const commands: Array<"hset" | "set"> = ["hset", "set"];

    for (const command of commands) {
      test(`fails when redis ${command} throws during start`, async () => {
        const redis = createRedis() as MockRedisClient & Bun.RedisClient;
        redis.setCommandFailure(command);

        const workflow = createWorkflowWithEchoResult(
          `redis-${command}-failure`,
          redis,
        );

        const [error, data] = await workflow.start({ id: 1 });

        if (command === "hset") {
          expect(error?.type).toBe("WorkflowError");
          expect(
            error?.message.includes("Unable to persist status for execution "),
          ).toBe(true);
        } else {
          expect(error?.type).toBe("WorkflowLockError");
        }

        expect(data).toBeNull();
      });
    }
  });

  describe("execute hset failure matrix", () => {
    // createExecution writes 10 fields; execute() writes "status":"running" as the 11th
    test("fails when hset fails during running status write", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;
      redis.failHsetAfterNCalls(10);

      const workflow = createWorkflowWithEchoResult("hset-running-fail", redis);

      const [error, data] = await workflow.start({ id: 1 });

      expect(error?.type).toBe("WorkflowError");
      expect(data).toBeNull();
    });

    // 10 createExecution + 2 running writes + 1 result = 13; 14th is "status":"completed"
    test("fails when hset fails during completed status write", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;
      redis.failHsetAfterNCalls(13);

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "hset-completed-fail",
        redis,
        handler: async () => "done",
      });

      const [error, data] = await workflow.start({ id: 1 });

      expect(error?.type).toBe("WorkflowError");
      expect(data).toBeNull();
    });
  });

  describe("cancel edge cases", () => {
    test("returns not found for unknown execution", async () => {
      const redis = createRedis();
      const workflow = createWorkflowWithEchoResult("cancel-unknown", redis);

      const [error, data] = await workflow.cancel("nonexistent");

      expect(error).toEqual({
        type: "WorkflowNotFoundError",
        message: "Workflow execution nonexistent not found",
      });
      expect(data).toBeNull();
    });

    test("succeeds silently when cancelling already-cancelled execution", async () => {
      const redis = createRedis();
      let shouldFail = true;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "cancel-twice",
        redis,
        handler: async ({ step }) => {
          await step("one", async () => {
            if (shouldFail) {
              shouldFail = false;
              throw new Error("fail");
            }

            return "ok";
          });

          return "done";
        },
      });

      await workflow.start({ id: 1 }, { executionId: "cancel-twice-1" });
      const [firstCancelError] = await workflow.cancel("cancel-twice-1");
      const [secondCancelError, secondCancelData] =
        await workflow.cancel("cancel-twice-1");

      expect(firstCancelError).toBeNull();
      expect(secondCancelError).toBeNull();
      expect(secondCancelData).toBeNull();
    });
  });

  describe("resume edge cases", () => {
    test("returns not found for unknown execution", async () => {
      const redis = createRedis();
      const workflow = createWorkflowWithEchoResult("resume-unknown", redis);

      const [error, data] = await workflow.resume("nonexistent");

      expect(error).toEqual({
        type: "WorkflowNotFoundError",
        message: "Workflow execution nonexistent not found",
      });
      expect(data).toBeNull();
    });
  });

  describe("run edge cases", () => {
    test("returns WorkflowExecutionError when handler throws", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "run-fail",
        redis,
        handler: async () => {
          throw new Error("handler crashed");
        },
      });

      const [error, result] = await workflow.run({ id: 1 });

      expect(error?.type).toBe("WorkflowExecutionError");
      expect(error?.message.includes("handler crashed")).toBe(true);
      expect(result).toBeNull();
    });

    test("returns WorkflowCancelledError when cancelled during execution", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "run-cancel",
        redis,
        handler: async ({ executionId, step }) => {
          await step("cancel-self", async () => {
            await workflow.cancel(executionId);
            return "ok";
          });

          await step("detect-cancel", async () => "ok");

          return "done";
        },
      });

      const [error, result] = await workflow.run({ id: 1 });

      expect(error?.type).toBe("WorkflowCancelledError");
      expect(result).toBeNull();
    });
  });

  describe("get on terminal states", () => {
    test("returns error message and failedAt on failed workflow", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "get-failed",
        redis,
        handler: async () => {
          throw new Error("something went wrong");
        },
      });

      await workflow.start({ id: 1 }, { executionId: "get-failed-1" });

      const [error, execution] = await workflow.get("get-failed-1");

      expect(error).toBeNull();
      expect(execution?.status).toBe("failed");
      expect(execution?.error).toBe("something went wrong");
      expect(typeof execution?.failedAt).toBe("number");
      expect(execution?.completedAt).toBeNull();
      expect(execution?.cancelledAt).toBeNull();
    });

    test("returns cancelledAt on cancelled workflow", async () => {
      const redis = createRedis();
      let shouldFail = true;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "get-cancelled",
        redis,
        handler: async ({ step }) => {
          await step("one", async () => {
            if (shouldFail) {
              shouldFail = false;
              throw new Error("fail");
            }

            return "ok";
          });

          return "done";
        },
      });

      await workflow.start({ id: 1 }, { executionId: "get-cancelled-1" });
      await workflow.cancel("get-cancelled-1");

      const [error, execution] = await workflow.get("get-cancelled-1");

      expect(error).toBeNull();
      expect(execution?.status).toBe("cancelled");
      expect(typeof execution?.cancelledAt).toBe("number");
      expect(execution?.completedAt).toBeNull();
    });
  });

  describe("falsy step output values", () => {
    const cases = [
      ["null", null],
      ["zero", 0],
      ["false", false],
      ["empty string", ""],
    ] as const;

    for (const [label, value] of cases) {
      test(`caches ${label} step output and does not re-run on resume`, async () => {
        const redis = createRedis();
        let stepRuns = 0;
        let shouldFailWorkflow = true;

        const workflow = defineWorkflow<{ id: number }, unknown>({
          name: `falsy-${label}`,
          redis,
          handler: async ({ step }) => {
            const result = await step("produce", async () => {
              stepRuns++;
              return value;
            });

            if (shouldFailWorkflow) {
              shouldFailWorkflow = false;
              throw new Error("fail after step");
            }

            return result;
          },
        });

        const executionId = `falsy-${label}-exec`;

        const [startError] = await workflow.start({ id: 1 }, { executionId });

        expect(startError).not.toBeNull();
        expect(stepRuns).toBe(1);

        const [resumeError, resumeData] = await workflow.resume(executionId);
        const [getError, execution] = await workflow.get(executionId);

        expect(resumeError).toBeNull();
        expect(resumeData?.status).toBe("completed");
        expect(getError).toBeNull();
        expect(execution?.result).toStrictEqual(value);
        expect(stepRuns).toBe(1);
      });
    }
  });

  describe("custom step output serializers", () => {
    test("uses serializeStepOutput and deserializeStepOutput on resume", async () => {
      const redis = createRedis();
      let serializeCalled = 0;
      let deserializeCalled = 0;
      let shouldFail = true;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "step-serializers",
        redis,
        serializeStepOutput: (value) => {
          serializeCalled++;
          return `custom:${JSON.stringify(value)}`;
        },
        deserializeStepOutput: (raw) => {
          deserializeCalled++;
          return JSON.parse(raw.replace("custom:", ""));
        },
        handler: async ({ step }) => {
          const result = await step("compute", async () => ({ value: 42 }));

          if (shouldFail) {
            shouldFail = false;
            throw new Error("fail after step");
          }

          return `value:${(result as { value: number }).value}`;
        },
      });

      await workflow.start({ id: 1 }, { executionId: "step-ser-1" });

      expect(serializeCalled).toBe(1);
      expect(deserializeCalled).toBe(0);

      const [resumeError] = await workflow.resume("step-ser-1");

      expect(resumeError).toBeNull();
      expect(serializeCalled).toBe(1);
      expect(deserializeCalled).toBe(1);
    });
  });

  describe("result deserializer", () => {
    test("returns serialization error when result deserializer throws", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "deser-result-error",
        redis,
        serializeResult: () => "custom-format",
        deserializeResult: () => {
          throw new Error("cannot deserialize");
        },
        handler: async () => "done",
      });

      await workflow.start({ id: 1 }, { executionId: "deser-1" });

      const [error, data] = await workflow.get("deser-1");

      expect(error?.type).toBe("WorkflowSerializationError");
      expect(data).toBeNull();
    });
  });

  describe("abort signal", () => {
    test("signal is aborted when step detects cancellation", async () => {
      const redis = createRedis();
      let signalAborted = false;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "abort-signal",
        redis,
        handler: async ({ executionId, step, signal }) => {
          signal.addEventListener("abort", () => {
            signalAborted = true;
          });

          await step("cancel-self", async () => {
            await workflow.cancel(executionId);
            return "ok";
          });

          await step("detect-cancel", async () => "ok");

          return "done";
        },
      });

      await workflow.run({ id: 1 });

      expect(signalAborted).toBe(true);
    });
  });
});

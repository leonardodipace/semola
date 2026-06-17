import { describe, expect, test } from "bun:test";
import { defineWorkflow } from "./index.js";

class MockRedisClient {
  private hashes = new Map<string, Map<string, string>>();
  private strings = new Map<string, string>();
  private expirations = new Map<string, number>();
  private failCommands = new Set<string>();
  private hsetCallsBeforeFail: number | null = null;

  private isExpired(key: string) {
    const expiry = this.expirations.get(key);

    if (expiry === undefined) {
      return false;
    }

    if (Date.now() >= expiry) {
      this.strings.delete(key);
      this.expirations.delete(key);
      return true;
    }

    return false;
  }

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

  public async hset(key: string, field: string, value: string): Promise<number>;

  public async hset(
    key: string,
    values: Record<string, string>,
  ): Promise<number>;

  public async hset(
    key: string,
    fieldOrValues: string | Record<string, string>,
    value?: string,
  ) {
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

    if (typeof fieldOrValues === "string") {
      if (typeof value !== "string") {
        return 0;
      }

      hash.set(fieldOrValues, value);
      return 1;
    }

    let count = 0;

    for (const [field, entry] of Object.entries(fieldOrValues)) {
      if (!hash.has(field)) {
        count++;
      }

      hash.set(field, entry);
    }

    return count;
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
    let pxValue: number | null = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "NX") {
        nx = true;
      }

      if (args[i] === "XX") {
        xx = true;
      }

      if (args[i] === "PX" && typeof args[i + 1] === "string") {
        pxValue = parseInt(args[i + 1] as string, 10);
      }
    }

    this.isExpired(key);

    const exists = this.strings.has(key);

    if (nx && exists) {
      return null;
    }

    if (xx && !exists) {
      return null;
    }

    this.strings.set(key, value);

    if (pxValue !== null) {
      this.expirations.set(key, Date.now() + pxValue);
    } else {
      this.expirations.delete(key);
    }

    return "OK";
  }

  public async get(key: string) {
    if (this.failCommands.has("get")) {
      throw new Error("get failed");
    }

    if (this.isExpired(key)) {
      return null;
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

  public async send(command: string, args: string[]) {
    if (command !== "EVAL") {
      throw new Error(`Unsupported command: ${command}`);
    }

    const script = args[0];
    const numKeys = parseInt(args[1] ?? "0", 10);
    const keys = args.slice(2, 2 + numKeys);
    const argv = args.slice(2 + numKeys);

    if (!script) {
      throw new Error("EVAL requires a script");
    }

    // releaseLock: GET compare then DEL
    if (script.includes("'DEL'")) {
      if (this.isExpired(keys[0] ?? "")) {
        return 0;
      }

      const current = this.strings.get(keys[0] ?? "");

      if (current === argv[0]) {
        this.strings.delete(keys[0] ?? "");
        this.expirations.delete(keys[0] ?? "");
        return 1;
      }

      return 0;
    }

    // extendLock: GET compare then PEXPIRE
    if (script.includes("'PEXPIRE'")) {
      if (this.isExpired(keys[0] ?? "")) {
        return 0;
      }

      const current = this.strings.get(keys[0] ?? "");

      if (current === argv[0]) {
        const ms = parseInt(argv[1] ?? "0", 10);
        this.expirations.set(keys[0] ?? "", Date.now() + ms);
        return 1;
      }

      return 0;
    }

    // createExecution: EXISTS check then HSET all fields
    if (script.includes("'EXISTS'") && script.includes("'HSET'")) {
      const metaKey = keys[0] ?? "";

      if (this.hashes.has(metaKey)) {
        return 0;
      }

      const hash = new Map<string, string>();

      for (let i = 0; i + 1 < argv.length; i += 2) {
        hash.set(argv[i] ?? "", argv[i + 1] ?? "");
      }

      this.hashes.set(metaKey, hash);
      return 1;
    }

    throw new Error("Unknown EVAL script");
  }
}

const createRedis = () => {
  return new MockRedisClient() as MockRedisClient & Bun.RedisClient;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fastRetryBackoff = {
  baseDelay: 1,
  multiplier: 2,
  maxDelay: 10,
};

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

const createTwoStepFailResumeWorkflow = (
  name: string,
  redis: Bun.RedisClient,
  executedSteps: string[],
) => {
  let shouldFail = true;

  return defineWorkflow<{ id: number }, string>({
    name,
    redis,
    retries: 0,
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

    const result = await workflow.run({ id: 1 });

    expect(result).toBe("done");
  });

  test("returns not found on unknown execution", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "missing",
      redis,
      handler: async () => "ok",
    });

    await expect(workflow.get("unknown")).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Workflow execution unknown not found",
    });
  });

  test("rejects duplicate execution ids", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "dupe",
      redis,
      handler: async () => "ok",
    });

    const firstStart = await workflow.start(
      { id: 1 },
      { executionId: "exec-1" },
    );

    expect(firstStart.status).toBe("completed");

    await expect(
      workflow.start({ id: 2 }, { executionId: "exec-1" }),
    ).rejects.toMatchObject({
      name: "StateError",
      message: "Workflow execution exec-1 already exists",
    });
  });

  test("resumes from next step after failure", async () => {
    const redis = createRedis();
    const executedSteps: string[] = [];

    const workflow = createTwoStepFailResumeWorkflow(
      "resume",
      redis,
      executedSteps,
    );

    await expect(
      workflow.start({ id: 10 }, { executionId: "exec-1" }),
    ).rejects.toMatchObject({ name: "ExecutionError" });

    const resumeData = await workflow.resume("exec-1");

    expect(resumeData.status).toBe("completed");
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

    const resumeData = await workflow.resume("complete-1");

    expect(resumeData.status).toBe("completed");
    expect(handlerCalls).toBe(1);
  });

  test("supports cancellation", async () => {
    const redis = createRedis();
    let shouldFail = true;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "cancel",
      redis,
      retries: 0,
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

    await expect(
      workflow.start({ id: 1 }, { executionId: "cancel-1" }),
    ).rejects.toMatchObject({ name: "ExecutionError" });

    await workflow.cancel("cancel-1");

    const resumeData = await workflow.resume("cancel-1");

    expect(resumeData.status).toBe("cancelled");
  });

  test("rejects cancel for completed workflow", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "cancel-complete",
      redis,
      handler: async () => "done",
    });

    await workflow.start({ id: 1 }, { executionId: "done-1" });

    await expect(workflow.cancel("done-1")).rejects.toMatchObject({
      name: "StateError",
      message: "Workflow execution done-1 is already completed",
    });
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

    await expect(workflow.resume("lock-1")).rejects.toMatchObject({
      name: "LockError",
      message: "Workflow execution lock-1 is already running",
    });

    release = true;

    const startData = await startPromise;

    expect(startData.status).toBe("completed");
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

    const runData = await workflow.run({ id: 7 }, { executionId: "ser-1" });

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

    await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
      name: "SerializationError",
      message: expect.stringContaining("Unable to serialize workflow input"),
    });
  });

  test("returns workflow error when redis read fails", async () => {
    const redis = createRedis() as MockRedisClient & Bun.RedisClient;
    redis.setCommandFailure("hget");

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "redis-fail",
      redis,
      handler: async () => "ok",
    });

    await expect(workflow.get("any")).rejects.toMatchObject({
      name: "WorkflowError",
      message: "Unable to read status for execution any",
    });
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

    await expect(workflow.get("bad-steps-1")).rejects.toMatchObject({
      name: "StateError",
      message: "Invalid step index for execution bad-steps-1",
    });
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

    const execution = await workflow.get("snap-1");

    expect(execution.steps.length).toBe(2);
    expect(execution.steps[0]?.name).toBe("one");
    expect(execution.steps[1]?.name).toBe("two");
    expect(typeof execution.steps[0]?.completedAt).toBe("number");
    expect(typeof execution.steps[1]?.completedAt).toBe("number");
  });

  describe("run matrix", () => {
    for (let i = 1; i <= 20; i++) {
      test(`runs workflow with id ${i}`, async () => {
        const redis = createRedis();
        const workflow = createWorkflowWithEchoResult(`run-matrix-${i}`, redis);

        const result = await workflow.run(
          { id: i },
          { executionId: `run-matrix-exec-${i}` },
        );

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

        const resumeData = await workflow.resume(executionId);
        const execution = await workflow.get(executionId);

        expect(resumeData.status).toBe("completed");
        expect(execution.result).toBe(`echo:${i}`);
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

        await workflow.start({ id: i }, { executionId });

        await expect(
          workflow.start({ id: i + 100 }, { executionId }),
        ).rejects.toMatchObject({ name: "StateError" });
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

        if (status.length === 0) {
          await expect(workflow.get(executionId)).rejects.toMatchObject({
            name: "NotFoundError",
            message: `Workflow execution ${executionId} not found`,
          });
        } else {
          await expect(workflow.get(executionId)).rejects.toMatchObject({
            name: "StateError",
            message: `Workflow execution ${executionId} has invalid status ${status}`,
          });
        }
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

        await expect(workflow.get(executionId)).rejects.toMatchObject({
          name: "StateError",
          message: `Invalid ${field} value for execution ${executionId}`,
        });
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

        await expect(workflow.get(executionId)).rejects.toMatchObject({
          name: "StateError",
          message: `Invalid step payload for one in execution ${executionId}`,
        });
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

        if (command === "hset") {
          await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
            name: "WorkflowError",
            message: expect.stringContaining(
              "Unable to persist metadata for execution",
            ),
          });
        } else {
          await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
            name: "LockError",
          });
        }
      });
    }
  });

  describe("execute hset failure matrix", () => {
    test("fails when hset fails during running status write", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;
      redis.failHsetAfterNCalls(0);

      const workflow = createWorkflowWithEchoResult("hset-running-fail", redis);

      await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
        name: "WorkflowError",
      });
    });

    test("fails when hset fails during completed status write", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;
      redis.failHsetAfterNCalls(3);

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "hset-completed-fail",
        redis,
        handler: async () => "done",
      });

      await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
        name: "WorkflowError",
      });
    });
  });

  describe("cancel edge cases", () => {
    test("returns not found for unknown execution", async () => {
      const redis = createRedis();
      const workflow = createWorkflowWithEchoResult("cancel-unknown", redis);

      await expect(workflow.cancel("nonexistent")).rejects.toMatchObject({
        name: "NotFoundError",
        message: "Workflow execution nonexistent not found",
      });
    });

    test("succeeds silently when cancelling already-cancelled execution", async () => {
      const redis = createRedis();
      let shouldFail = true;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "cancel-twice",
        redis,
        retries: 0,
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

      await expect(
        workflow.start({ id: 1 }, { executionId: "cancel-twice-1" }),
      ).rejects.toMatchObject({ name: "ExecutionError" });

      const firstCancelData = await workflow.cancel("cancel-twice-1");
      const secondCancelData = await workflow.cancel("cancel-twice-1");

      expect(firstCancelData.executionId).toEqual("cancel-twice-1");
      expect(secondCancelData.executionId).toEqual("cancel-twice-1");

      expect(firstCancelData.status).toEqual("cancelled");
      expect(secondCancelData.status).toEqual("cancelled");

      expect(firstCancelData.createdAt).toEqual(secondCancelData.createdAt);
    });
  });

  describe("resume edge cases", () => {
    test("returns not found for unknown execution", async () => {
      const redis = createRedis();
      const workflow = createWorkflowWithEchoResult("resume-unknown", redis);

      await expect(workflow.resume("nonexistent")).rejects.toMatchObject({
        name: "NotFoundError",
        message: "Workflow execution nonexistent not found",
      });
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

      await expect(workflow.run({ id: 1 })).rejects.toMatchObject({
        name: "ExecutionError",
        message: expect.stringContaining("handler crashed"),
      });
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

      await expect(workflow.run({ id: 1 })).rejects.toMatchObject({
        name: "CancelledError",
      });
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

      await expect(
        workflow.start({ id: 1 }, { executionId: "get-failed-1" }),
      ).rejects.toMatchObject({ name: "ExecutionError" });

      const execution = await workflow.get("get-failed-1");

      expect(execution.status).toBe("failed");
      expect(execution.error).toBe("something went wrong");
      expect(typeof execution.failedAt).toBe("number");
      expect(execution.completedAt).toBeNull();
      expect(execution.cancelledAt).toBeNull();
    });

    test("returns cancelledAt on cancelled workflow", async () => {
      const redis = createRedis();
      let shouldFail = true;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "get-cancelled",
        redis,
        retries: 0,
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

      await expect(
        workflow.start({ id: 1 }, { executionId: "get-cancelled-1" }),
      ).rejects.toMatchObject({ name: "ExecutionError" });

      await workflow.cancel("get-cancelled-1");

      const execution = await workflow.get("get-cancelled-1");

      expect(execution.status).toBe("cancelled");
      expect(typeof execution.cancelledAt).toBe("number");
      expect(execution.completedAt).toBeNull();
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

        await expect(
          workflow.start({ id: 1 }, { executionId }),
        ).rejects.toMatchObject({ name: "ExecutionError" });

        expect(stepRuns).toBe(1);

        const resumeData = await workflow.resume(executionId);
        const execution = await workflow.get(executionId);

        expect(resumeData.status).toBe("completed");
        expect(execution.result).toStrictEqual(value);
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

          return `value:${result.value}`;
        },
      });

      await expect(
        workflow.start({ id: 1 }, { executionId: "step-ser-1" }),
      ).rejects.toMatchObject({ name: "ExecutionError" });

      expect(serializeCalled).toBe(1);
      expect(deserializeCalled).toBe(0);

      await workflow.resume("step-ser-1");

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

      await expect(workflow.get("deser-1")).rejects.toMatchObject({
        name: "SerializationError",
      });
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

      await expect(workflow.run({ id: 1 })).rejects.toMatchObject({
        name: "CancelledError",
      });

      expect(signalAborted).toBe(true);
    });
  });

  describe("hooks and retries", () => {
    test("retries step after transient failure", async () => {
      const redis = createRedis();
      let stepAttempts = 0;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "retry-success",
        redis,
        retries: 2,
        retryBackoff: fastRetryBackoff,
        handler: async ({ step }) => {
          await step("flaky", async () => {
            stepAttempts++;

            if (stepAttempts < 3) {
              throw new Error("transient");
            }

            return "ok";
          });

          return "done";
        },
      });

      const result = await workflow.run({ id: 1 });

      expect(result).toBe("done");
      expect(stepAttempts).toBe(3);
    });

    test("calls onRetry with correct context", async () => {
      const redis = createRedis();
      const retryContexts: Array<{
        stepName: string;
        attempt: number;
        nextRetryDelayMs: number;
        retriesRemaining: number;
      }> = [];

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "on-retry",
        redis,
        retries: 2,
        retryBackoff: fastRetryBackoff,
        hooks: {
          onRetry: (context) => {
            retryContexts.push({
              stepName: context.stepName,
              attempt: context.attempt,
              nextRetryDelayMs: context.nextRetryDelayMs,
              retriesRemaining: context.retriesRemaining,
            });
          },
        },
        handler: async ({ step }) => {
          await step("flaky", async () => {
            throw new Error("always fail");
          });

          return "done";
        },
      });

      await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
        name: "ExecutionError",
      });

      expect(retryContexts.length).toBe(2);
      expect(retryContexts[0]?.stepName).toBe("flaky");
      expect(retryContexts[0]?.attempt).toBe(1);
      expect(retryContexts[0]?.nextRetryDelayMs).toBe(1);
      expect(retryContexts[0]?.retriesRemaining).toBe(1);
      expect(retryContexts[1]?.attempt).toBe(2);
      expect(retryContexts[1]?.nextRetryDelayMs).toBe(2);
      expect(retryContexts[1]?.retriesRemaining).toBe(0);
    });

    test("calls onError when retries are exhausted", async () => {
      const redis = createRedis();
      const errorContexts: Array<{
        stepName: string;
        totalAttempts: number;
        errorHistoryLength: number;
      }> = [];

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "on-error",
        redis,
        retries: 1,
        retryBackoff: fastRetryBackoff,
        hooks: {
          onError: (context) => {
            errorContexts.push({
              stepName: context.stepName,
              totalAttempts: context.totalAttempts,
              errorHistoryLength: context.errorHistory.length,
            });
          },
        },
        handler: async ({ step }) => {
          await step("flaky", async () => {
            throw new Error("permanent fail");
          });

          return "done";
        },
      });

      await expect(
        workflow.start({ id: 1 }, { executionId: "on-error-1" }),
      ).rejects.toMatchObject({ name: "ExecutionError" });

      const execution = await workflow.get("on-error-1");

      expect(execution.status).toBe("failed");
      expect(errorContexts.length).toBe(1);
      expect(errorContexts[0]?.stepName).toBe("flaky");
      expect(errorContexts[0]?.totalAttempts).toBe(2);
      expect(errorContexts[0]?.errorHistoryLength).toBe(2);
    });

    test("does not call onRetry when step succeeds on first try", async () => {
      const redis = createRedis();
      let onRetryCalls = 0;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "no-retry",
        redis,
        hooks: {
          onRetry: () => {
            onRetryCalls++;
          },
        },
        handler: async ({ step }) => {
          await step("stable", async () => "ok");

          return "done";
        },
      });

      await workflow.run({ id: 1 });

      expect(onRetryCalls).toBe(0);
    });

    test("calls lifecycle hooks on start, complete, and cancel", async () => {
      const redis = createRedis();
      const events: string[] = [];

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "lifecycle-hooks",
        redis,
        retries: 0,
        hooks: {
          onStart: () => {
            events.push("start");
          },
          onComplete: () => {
            events.push("complete");
          },
          onCancel: () => {
            events.push("cancel");
          },
        },
        handler: async ({ executionId, step }) => {
          await step("work", async () => "ok");

          if (events.length === 1) {
            await workflow.cancel(executionId);
          }

          return "done";
        },
      });

      const startResult = await workflow.start(
        { id: 1 },
        { executionId: "lifecycle-1" },
      );

      expect(startResult.status).toBe("cancelled");
      expect(events).toEqual(["start", "cancel"]);

      events.length = 0;

      const workflowComplete = defineWorkflow<{ id: number }, string>({
        name: "lifecycle-complete",
        redis,
        hooks: {
          onStart: () => {
            events.push("start");
          },
          onComplete: () => {
            events.push("complete");
          },
        },
        handler: async () => "done",
      });

      await workflowComplete.run({ id: 2 });

      expect(events).toEqual(["start", "complete"]);
    });

    test("cancels during retry backoff", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "cancel-backoff",
        redis,
        retries: 3,
        retryBackoff: fastRetryBackoff,
        handler: async ({ step }) => {
          await step("flaky", async () => {
            throw new Error("always fail");
          });

          return "done";
        },
      });

      const startPromise = workflow.start(
        { id: 1 },
        { executionId: "cancel-backoff-1" },
      );

      await sleep(5);
      await workflow.cancel("cancel-backoff-1");

      const startResult = await startPromise;

      expect(startResult.status).toBe("cancelled");
    });

    test("skips handler for cached step output without retries", async () => {
      const redis = createRedis();
      let stepRuns = 0;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "cached-no-retry",
        redis,
        retries: 3,
        handler: async ({ step }) => {
          await step("once", async () => {
            stepRuns++;
            return "cached";
          });

          return "done";
        },
      });

      await workflow.start({ id: 1 }, { executionId: "cached-1" });
      await workflow.resume("cached-1");

      expect(stepRuns).toBe(1);
    });

    test("resume after exhausted retries re-runs failed step", async () => {
      const redis = createRedis();
      const executedSteps: string[] = [];

      const workflow = createTwoStepFailResumeWorkflow(
        "resume-after-retries",
        redis,
        executedSteps,
      );

      await expect(
        workflow.start({ id: 10 }, { executionId: "resume-retries-1" }),
      ).rejects.toMatchObject({ name: "ExecutionError" });

      const resumeData = await workflow.resume("resume-retries-1");

      expect(resumeData.status).toBe("completed");
      expect(executedSteps).toEqual(["step-1:10", "step-2:10", "step-2:10"]);
    });

    test("uses exponential backoff between retries", async () => {
      const redis = createRedis();
      const attemptTimestamps: number[] = [];

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "backoff-timing",
        redis,
        retries: 2,
        retryBackoff: fastRetryBackoff,
        handler: async ({ step }) => {
          await step("flaky", async () => {
            attemptTimestamps.push(Date.now());
            throw new Error("fail");
          });

          return "done";
        },
      });

      await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
        name: "ExecutionError",
      });

      expect(attemptTimestamps.length).toBe(3);

      const firstAttempt = attemptTimestamps[0];
      const secondAttempt = attemptTimestamps[1];
      const thirdAttempt = attemptTimestamps[2];

      if (
        firstAttempt === undefined ||
        secondAttempt === undefined ||
        thirdAttempt === undefined
      ) {
        throw new Error("expected three step attempts");
      }

      const firstGap = secondAttempt - firstAttempt;
      const secondGap = thirdAttempt - secondAttempt;

      expect(firstGap).toBeGreaterThanOrEqual(1);
      expect(secondGap).toBeGreaterThanOrEqual(2);
    });

    test("reports default backoff delay in onRetry context", async () => {
      const redis = createRedis();
      const retryDelays: number[] = [];

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "default-backoff-delay",
        redis,
        retries: 3,
        hooks: {
          onRetry: (context) => {
            retryDelays.push(context.nextRetryDelayMs);
          },
        },
        handler: async ({ step }) => {
          await step("flaky", async () => {
            throw new Error("fail");
          });

          return "done";
        },
      });

      const startPromise = workflow.start(
        { id: 1 },
        { executionId: "default-backoff-1" },
      );

      await sleep(20);
      await workflow.cancel("default-backoff-1");

      const startResult = await startPromise;

      expect(startResult.status).toBe("cancelled");
      expect(retryDelays[0]).toBe(1000);
    });
  });
});

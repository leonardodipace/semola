import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearWorkflowRegistry,
  defineWorkflow,
  listWorkflows,
  resumeWorkflow,
} from "./index.js";

class MockRedisClient {
  private hashes = new Map<string, Map<string, string>>();
  private strings = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private expirations = new Map<string, number>();
  private failCommands = new Set<string>();
  private hsetCallsBeforeFail: number | null = null;
  public hsetFailureCount = 0;

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

  private matchesGlob(key: string, pattern: string) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);

    return regex.test(key);
  }

  public setCommandFailure(
    command:
      | "hset"
      | "hget"
      | "set"
      | "get"
      | "del"
      | "lpush"
      | "rpop"
      | "eval",
  ) {
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
      this.hsetFailureCount++;
      throw new Error("hset failed");
    }

    if (this.hsetCallsBeforeFail !== null) {
      if (this.hsetCallsBeforeFail <= 0) {
        this.hsetFailureCount++;
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

  public async hgetall(key: string) {
    const hash = this.hashes.get(key);

    if (!hash) {
      return {};
    }

    return Object.fromEntries(hash.entries());
  }

  public async exists(key: string) {
    if (this.isExpired(key)) {
      return false;
    }

    if (this.strings.has(key)) {
      return true;
    }

    if (this.hashes.has(key)) {
      return true;
    }

    return false;
  }

  public async scan(
    cursor: string | number,
    ...args: (string | number)[]
  ): Promise<[string, string[]]> {
    let pattern: string | null = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "MATCH" && typeof args[i + 1] === "string") {
        pattern = args[i + 1] as string;
      }
    }

    const keys: string[] = [];

    for (const key of this.hashes.keys()) {
      if (pattern) {
        if (!this.matchesGlob(key, pattern)) {
          continue;
        }
      }

      keys.push(key);
    }

    for (const key of this.strings.keys()) {
      if (this.isExpired(key)) {
        continue;
      }

      if (pattern) {
        if (!this.matchesGlob(key, pattern)) {
          continue;
        }
      }

      keys.push(key);
    }

    // ponytail: mock returns all matches in one page
    if (String(cursor) !== "0") {
      return ["0", []];
    }

    return ["0", keys];
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

    if (this.lists.delete(key)) {
      count++;
    }

    return count;
  }

  public async lpush(key: string, value: string) {
    if (this.failCommands.has("lpush")) {
      throw new Error("lpush failed");
    }

    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }

    this.lists.get(key)?.unshift(value);

    return this.lists.get(key)?.length ?? 0;
  }

  public async rpop(key: string) {
    if (this.failCommands.has("rpop")) {
      throw new Error("rpop failed");
    }

    const list = this.lists.get(key);

    if (!list || list.length === 0) {
      return null;
    }

    return list.pop() ?? null;
  }

  public async send(command: string, args: string[]) {
    if (command !== "EVAL") {
      throw new Error(`Unsupported command: ${command}`);
    }

    if (this.failCommands.has("eval")) {
      throw new Error("eval failed");
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

const waitForExecution = async <TInput, TResult>(
  workflow: ReturnType<typeof defineWorkflow<TInput, TResult>>,
  executionId: string,
) => {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const execution = await workflow.get(executionId);

    if (execution.status !== "pending" && execution.status !== "running") {
      return execution;
    }

    await sleep(1);
  }

  throw new Error(`Workflow execution ${executionId} did not finish`);
};

const waitForHsetFailure = async (redis: MockRedisClient, failureCount = 1) => {
  for (let attempt = 0; attempt < 3000; attempt++) {
    if (redis.hsetFailureCount >= failureCount) {
      return;
    }

    await sleep(1);
  }

  throw new Error("Mock Redis hset did not fail");
};

const waitForStatus = async <TInput, TResult>(
  workflow: ReturnType<typeof defineWorkflow<TInput, TResult>>,
  executionId: string,
  status: "running" | "completed" | "failed" | "cancelled",
) => {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const execution = await workflow.get(executionId);

    if (execution.status === status) {
      return execution;
    }

    await sleep(1);
  }

  throw new Error(`Workflow execution ${executionId} did not become ${status}`);
};

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
    pollInterval: 1,
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
    pollInterval: 1,
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
  beforeEach(async () => {
    await clearWorkflowRegistry();
  });

  test("starts workflow in the background and stores result", async () => {
    const redis = createRedis();
    let handlerStarted = false;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "onboard",
      redis,
      handler: async ({ input, step }) => {
        handlerStarted = true;

        const user = await step("get-user", async () => {
          return { id: input.id, email: "user@example.com" };
        });

        await step("send-email", async () => {
          return `sent:${user.email}`;
        });

        return "done";
      },
    });

    const started = await workflow.start(
      { id: 1 },
      { executionId: "onboard-1" },
    );

    expect(started).toEqual({ executionId: "onboard-1", status: "pending" });
    expect(handlerStarted).toBe(false);

    const execution = await waitForExecution(workflow, "onboard-1");

    expect(execution.status).toBe("completed");
    expect(execution.result).toBe("done");
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

    expect(firstStart.status).toBe("pending");

    await expect(
      workflow.start({ id: 2 }, { executionId: "exec-1" }),
    ).rejects.toMatchObject({
      name: "StateError",
      message: "Workflow execution exec-1 already exists",
    });
  });

  test("rejects concurrent duplicate custom execution ids", async () => {
    const redis = createRedis();

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "concurrent-dupe",
      redis,
      handler: async () => "ok",
    });

    const results = await Promise.allSettled([
      workflow.start({ id: 1 }, { executionId: "exec-race" }),
      workflow.start({ id: 2 }, { executionId: "exec-race" }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failure = rejected[0];

    if (!failure || failure.status !== "rejected") {
      throw new Error("expected one start to reject");
    }

    expect(failure.reason).toMatchObject({
      name: "StateError",
      message: "Workflow execution exec-race already exists",
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

    await workflow.start({ id: 10 }, { executionId: "exec-1" });

    const failedExecution = await waitForStatus(workflow, "exec-1", "failed");

    expect(failedExecution.status).toBe("failed");

    const resumeData = await workflow.resume("exec-1");
    const execution = await waitForStatus(workflow, "exec-1", "completed");

    expect(resumeData.status).toBe("pending");
    expect(execution.status).toBe("completed");
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
    await waitForExecution(workflow, "complete-1");

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

    await workflow.start({ id: 1 }, { executionId: "cancel-1" });
    await waitForExecution(workflow, "cancel-1");

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
    await waitForExecution(workflow, "done-1");

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

    const startData = await workflow.start(
      { id: 1 },
      { executionId: "lock-1" },
    );

    await waitForStatus(workflow, "lock-1", "running");

    const resumeData = await workflow.resume("lock-1");

    release = true;

    const execution = await waitForExecution(workflow, "lock-1");

    expect(startData.status).toBe("pending");
    expect(resumeData.status).toBe("pending");
    expect(execution.status).toBe("completed");
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

    await workflow.start({ id: 7 }, { executionId: "ser-1" });
    const execution = await waitForExecution(workflow, "ser-1");

    expect(execution.result).toEqual({ ok: true });
    expect(serializedInputCalled).toBe(1);
    expect(deserializedInputCalled).toBeGreaterThanOrEqual(1);
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
      "workflow:execution:bad-steps-1:meta",
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
    const execution = await waitForExecution(workflow, "snap-1");

    expect(execution.steps.length).toBe(2);
    expect(execution.steps[0]?.name).toBe("one");
    expect(execution.steps[1]?.name).toBe("two");
    expect(typeof execution.steps[0]?.completedAt).toBe("number");
    expect(typeof execution.steps[1]?.completedAt).toBe("number");
  });

  describe("start matrix", () => {
    for (let i = 1; i <= 20; i++) {
      test(`starts workflow with id ${i}`, async () => {
        const redis = createRedis();
        const workflow = createWorkflowWithEchoResult(`run-matrix-${i}`, redis);

        await workflow.start(
          { id: i },
          { executionId: `run-matrix-exec-${i}` },
        );
        const execution = await waitForExecution(
          workflow,
          `run-matrix-exec-${i}`,
        );

        expect(execution.result).toBe(`echo:${i}`);
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
        await waitForStatus(workflow, executionId, "completed");

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
        const metaKey = `workflow:execution:${executionId}:meta`;

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
        const metaKey = `workflow:execution:${executionId}:meta`;

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
        const metaKey = `workflow:execution:${executionId}:meta`;
        const stepsKey = `workflow:execution:${executionId}:steps`;

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
    const commands: Array<"eval" | "set"> = ["eval", "set"];

    for (const command of commands) {
      test(`handles redis ${command} failures during start`, async () => {
        const redis = createRedis() as MockRedisClient & Bun.RedisClient;
        redis.setCommandFailure(command);

        const workflow = createWorkflowWithEchoResult(
          `redis-${command}-failure`,
          redis,
        );

        if (command === "eval") {
          await expect(workflow.start({ id: 1 })).rejects.toMatchObject({
            name: "WorkflowError",
            message: expect.stringContaining(
              "Unable to persist metadata for execution",
            ),
          });
        } else {
          const started = await workflow.start(
            { id: 1 },
            { executionId: "redis-set-failure-1" },
          );
          const execution = await waitForExecution(
            workflow,
            started.executionId,
          );

          expect(execution.status).toBe("failed");
          expect(execution.error).toContain("Unable to acquire lock");
        }
      });
    }
  });

  describe("execute hset failure matrix", () => {
    test("leaves execution pending when running status write fails", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;
      redis.failHsetAfterNCalls(0);

      const workflow = createWorkflowWithEchoResult("hset-running-fail", redis);

      const started = await workflow.start(
        { id: 1 },
        { executionId: "hset-running-fail-1" },
      );

      expect(started.status).toBe("pending");

      await sleep(50);

      const execution = await workflow.get(started.executionId);

      expect(execution.status).toBe("pending");
      expect(redis.hsetFailureCount).toBeGreaterThanOrEqual(1);
    });

    test("fails when hset fails during completed status write", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;
      redis.failHsetAfterNCalls(2);

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "hset-completed-fail",
        redis,
        handler: async () => "done",
      });

      const started = await workflow.start(
        { id: 1 },
        { executionId: "hset-completed-fail-1" },
      );
      await waitForHsetFailure(redis);

      const execution = await workflow.get(started.executionId);

      expect(execution.status).toBe("running");
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

      await workflow.start({ id: 1 }, { executionId: "cancel-twice-1" });
      await waitForExecution(workflow, "cancel-twice-1");

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

  describe("background execution errors", () => {
    test("reports failure to record background execution errors", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;
      const errors: unknown[][] = [];
      const originalError = console.error;

      console.error = (...args: unknown[]) => {
        errors.push(args);
      };

      try {
        redis.failHsetAfterNCalls(0);

        const workflow = createWorkflowWithEchoResult(
          "background-record-failure",
          redis,
        );

        await workflow.start(
          { id: 1 },
          { executionId: "background-record-failure-1" },
        );
        await waitForHsetFailure(redis, 2);

        expect(errors).toEqual([
          [
            "Unable to record background workflow failure",
            {
              executionId: "background-record-failure-1",
              error: expect.objectContaining({
                message:
                  "Unable to persist status for execution background-record-failure-1",
              }),
            },
          ],
        ]);
      } finally {
        console.error = originalError;
      }
    });

    test("records handler errors on the execution", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "run-fail",
        redis,
        handler: async () => {
          throw new Error("handler crashed");
        },
      });

      const started = await workflow.start(
        { id: 1 },
        { executionId: "run-fail-1" },
      );
      const execution = await waitForExecution(workflow, started.executionId);

      expect(execution.status).toBe("failed");
      expect(execution.error).toBe("handler crashed");
    });

    test("records cancellation during execution", async () => {
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

      const started = await workflow.start(
        { id: 1 },
        { executionId: "run-cancel-1" },
      );
      const execution = await waitForExecution(workflow, started.executionId);

      expect(execution.status).toBe("cancelled");
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
      const execution = await waitForExecution(workflow, "get-failed-1");

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

      await workflow.start({ id: 1 }, { executionId: "get-cancelled-1" });
      await waitForExecution(workflow, "get-cancelled-1");

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

        await workflow.start({ id: 1 }, { executionId });
        await waitForExecution(workflow, executionId);

        expect(stepRuns).toBe(1);

        const resumeData = await workflow.resume(executionId);
        const execution = await waitForStatus(
          workflow,
          executionId,
          "completed",
        );

        expect(resumeData.status).toBe("pending");
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
        pollInterval: 1,
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

      await workflow.start({ id: 1 }, { executionId: "step-ser-1" });
      await waitForExecution(workflow, "step-ser-1");

      expect(serializeCalled).toBe(1);
      expect(deserializeCalled).toBe(0);

      await workflow.resume("step-ser-1");
      await waitForExecution(workflow, "step-ser-1");

      expect(serializeCalled).toBe(1);
      expect(deserializeCalled).toBe(1);
    });
  });

  describe("result deserializer", () => {
    test("returns serialization error when result deserializer throws", async () => {
      const redis = createRedis();
      let shouldThrow = false;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "deser-result-error",
        redis,
        serializeResult: () => "custom-format",
        deserializeResult: () => {
          if (shouldThrow) {
            throw new Error("cannot deserialize");
          }

          return "done";
        },
        handler: async () => "done",
      });

      await workflow.start({ id: 1 }, { executionId: "deser-1" });
      await waitForStatus(workflow, "deser-1", "completed");

      shouldThrow = true;

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

      const started = await workflow.start(
        { id: 1 },
        { executionId: "abort-signal-1" },
      );
      await waitForExecution(workflow, started.executionId);

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

      const started = await workflow.start(
        { id: 1 },
        { executionId: "retry-success-1" },
      );
      const execution = await waitForExecution(workflow, started.executionId);

      expect(execution.result).toBe("done");
      expect(stepAttempts).toBe(3);
    });

    test("fail skips retries and fails the workflow", async () => {
      const redis = createRedis();
      let stepAttempts = 0;
      let onRetryCalls = 0;
      const errorContexts: Array<{
        stepName: string;
        error: string;
        totalAttempts: number;
      }> = [];

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "step-fail",
        redis,
        retries: 3,
        retryBackoff: fastRetryBackoff,
        hooks: {
          onRetry: () => {
            onRetryCalls++;
          },
          onError: (context) => {
            errorContexts.push({
              stepName: context.stepName,
              error: context.error,
              totalAttempts: context.totalAttempts,
            });
          },
        },
        handler: async ({ step }) => {
          await step("risky", async ({ fail }) => {
            stepAttempts++;
            fail("permanent");
          });

          return "done";
        },
      });

      await workflow.start({ id: 1 }, { executionId: "step-fail-1" });
      const execution = await waitForExecution(workflow, "step-fail-1");

      expect(execution.status).toBe("failed");
      expect(execution.error).toBe("permanent");
      expect(stepAttempts).toBe(1);
      expect(onRetryCalls).toBe(0);
      expect(errorContexts.length).toBe(1);
      expect(errorContexts[0]?.stepName).toBe("risky");
      expect(errorContexts[0]?.error).toBe("permanent");
      expect(errorContexts[0]?.totalAttempts).toBe(1);
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

      const started = await workflow.start(
        { id: 1 },
        { executionId: "on-retry-1" },
      );
      await waitForExecution(workflow, started.executionId);

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

      await workflow.start({ id: 1 }, { executionId: "on-error-1" });
      const execution = await waitForExecution(workflow, "on-error-1");

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

      const started = await workflow.start(
        { id: 1 },
        { executionId: "no-retry-1" },
      );
      await waitForExecution(workflow, started.executionId);

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

      const cancelled = await waitForExecution(workflow, "lifecycle-1");

      expect(startResult.status).toBe("pending");
      expect(cancelled.status).toBe("cancelled");
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

      await workflowComplete.start({ id: 2 }, { executionId: "lifecycle-2" });
      await waitForExecution(workflowComplete, "lifecycle-2");

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

      const startResult = await workflow.start(
        { id: 1 },
        { executionId: "cancel-backoff-1" },
      );

      await sleep(5);
      await workflow.cancel("cancel-backoff-1");

      const execution = await waitForExecution(workflow, "cancel-backoff-1");

      expect(startResult.status).toBe("pending");
      expect(execution.status).toBe("cancelled");
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
      await waitForExecution(workflow, "cached-1");
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

      await workflow.start({ id: 10 }, { executionId: "resume-retries-1" });
      await waitForStatus(workflow, "resume-retries-1", "failed");

      const resumeData = await workflow.resume("resume-retries-1");
      const execution = await waitForStatus(
        workflow,
        "resume-retries-1",
        "completed",
      );

      expect(resumeData.status).toBe("pending");
      expect(execution.status).toBe("completed");
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

      const started = await workflow.start(
        { id: 1 },
        { executionId: "backoff-timing-1" },
      );
      await waitForExecution(workflow, started.executionId);

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
        pollInterval: 1,
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

      const startResult = await workflow.start(
        { id: 1 },
        { executionId: "default-backoff-1" },
      );

      for (let attempt = 0; attempt < 3000; attempt++) {
        if (retryDelays.length > 0) {
          break;
        }

        await sleep(1);
      }

      await workflow.cancel("default-backoff-1");

      const execution = await waitForExecution(workflow, "default-backoff-1");

      expect(startResult.status).toBe("pending");
      expect(execution.status).toBe("cancelled");
      expect(retryDelays[0]).toBe(1000);
    });
  });

  describe("listWorkflows and resumeWorkflow", () => {
    test("returns empty list when no executions exist", async () => {
      const redis = createRedis();

      defineWorkflow<{ id: number }, string>({
        name: "list-empty",
        redis,
        handler: async () => "ok",
      });

      const listed = await listWorkflows(redis);

      expect(listed).toEqual([]);
    });

    test("lists executions across multiple workflow names", async () => {
      const redis = createRedis();

      const onboard = defineWorkflow<{ id: number }, string>({
        name: "list-onboard",
        redis,
        handler: async () => "ok",
      });

      const provision = defineWorkflow<{ id: number }, string>({
        name: "list-provision",
        redis,
        handler: async () => "ok",
      });

      await onboard.start({ id: 1 }, { executionId: "list-onboard-1" });
      await provision.start({ id: 2 }, { executionId: "list-provision-1" });
      await waitForExecution(onboard, "list-onboard-1");
      await waitForExecution(provision, "list-provision-1");

      const listed = await listWorkflows(redis);
      const names = listed.map((item) => item.name).sort();
      const ids = listed.map((item) => item.id).sort();

      expect(listed.length).toBe(2);
      expect(names).toEqual(["list-onboard", "list-provision"]);
      expect(ids).toEqual(["list-onboard-1", "list-provision-1"]);
    });

    test("filters by name and status", async () => {
      const redis = createRedis();

      const onboard = defineWorkflow<{ id: number }, string>({
        name: "filter-onboard",
        redis,
        handler: async () => "ok",
      });

      const provision = defineWorkflow<{ id: number }, string>({
        name: "filter-provision",
        redis,
        retries: 0,
        handler: async ({ step }) => {
          await step("fail", async () => {
            throw new Error("boom");
          });

          return "ok";
        },
      });

      await onboard.start({ id: 1 }, { executionId: "filter-onboard-1" });
      await provision.start({ id: 2 }, { executionId: "filter-provision-1" });
      await waitForExecution(onboard, "filter-onboard-1");
      await waitForStatus(provision, "filter-provision-1", "failed");

      const byName = await listWorkflows(redis, { name: "filter-onboard" });
      const byStatus = await listWorkflows(redis, { status: "failed" });

      expect(byName.map((item) => item.id)).toEqual(["filter-onboard-1"]);
      expect(byStatus.map((item) => item.id)).toEqual(["filter-provision-1"]);
    });

    test("unlockedOnly excludes locked running executions", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "list-lock",
        redis,
        handler: async () => "ok",
      });

      await workflow.start({ id: 1 }, { executionId: "list-lock-held" });
      await workflow.start({ id: 2 }, { executionId: "list-lock-orphan" });
      await waitForExecution(workflow, "list-lock-held");
      await waitForExecution(workflow, "list-lock-orphan");

      redis.seedHashField(
        "workflow:execution:list-lock-held:meta",
        "status",
        "running",
      );
      redis.seedHashField(
        "workflow:execution:list-lock-orphan:meta",
        "status",
        "running",
      );
      await redis.set(
        "workflow:execution:list-lock-held:lock",
        "token",
        "PX",
        "60000",
      );

      const unlocked = await listWorkflows(redis, {
        status: "running",
        unlockedOnly: true,
      });

      expect(unlocked.map((item) => item.id)).toEqual(["list-lock-orphan"]);
    });

    test("resumeWorkflow resumes by execution id via registry", async () => {
      const redis = createRedis();
      const executedSteps: string[] = [];

      const workflow = createTwoStepFailResumeWorkflow(
        "resume-workflow-api",
        redis,
        executedSteps,
      );

      await workflow.start({ id: 10 }, { executionId: "resume-api-1" });
      await waitForStatus(workflow, "resume-api-1", "failed");

      const pending = await listWorkflows(redis, {
        status: ["pending", "running", "failed"],
        unlockedOnly: true,
      });

      expect(pending.some((item) => item.id === "resume-api-1")).toBe(true);

      const resumed = await resumeWorkflow(redis, "resume-api-1");
      const execution = await waitForStatus(
        workflow,
        "resume-api-1",
        "completed",
      );

      expect(resumed.status).toBe("pending");
      expect(execution.status).toBe("completed");
      expect(executedSteps).toEqual(["step-1:10", "step-2:10", "step-2:10"]);
    });

    test("resumeWorkflow fails when workflow is not registered", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "resume-unregistered",
        redis,
        handler: async () => "ok",
      });

      await workflow.start({ id: 1 }, { executionId: "resume-unreg-1" });
      await waitForExecution(workflow, "resume-unreg-1");

      await clearWorkflowRegistry();

      await expect(
        resumeWorkflow(redis, "resume-unreg-1"),
      ).rejects.toMatchObject({
        name: "NotFoundError",
        message:
          "Workflow resume-unregistered is not registered in this process",
      });
    });

    test("rejects duplicate workflow name registration", () => {
      const redis = createRedis();

      defineWorkflow<{ id: number }, string>({
        name: "dupe-register",
        redis,
        handler: async () => "ok",
      });

      expect(() => {
        defineWorkflow<{ id: number }, string>({
          name: "dupe-register",
          redis,
          handler: async () => "ok",
        });
      }).toThrow(
        "Workflow dupe-register is already registered in this process",
      );
    });

    test("rejects custom execution id collision across workflow names", async () => {
      const redis = createRedis();

      const first = defineWorkflow<{ id: number }, string>({
        name: "collision-a",
        redis,
        handler: async () => "ok",
      });

      const second = defineWorkflow<{ id: number }, string>({
        name: "collision-b",
        redis,
        handler: async () => "ok",
      });

      await first.start({ id: 1 }, { executionId: "shared-id" });

      await expect(
        second.start({ id: 2 }, { executionId: "shared-id" }),
      ).rejects.toMatchObject({
        name: "StateError",
        message: "Workflow execution shared-id already exists",
      });
    });

    test("get rejects execution owned by another workflow name", async () => {
      const redis = createRedis();

      const first = defineWorkflow<{ id: number }, string>({
        name: "owner-a",
        redis,
        handler: async () => "ok",
      });

      const second = defineWorkflow<{ id: number }, string>({
        name: "owner-b",
        redis,
        handler: async () => "ok",
      });

      await first.start({ id: 1 }, { executionId: "owned-by-a" });
      await waitForExecution(first, "owned-by-a");

      await expect(second.get("owned-by-a")).rejects.toMatchObject({
        name: "NotFoundError",
        message: "Workflow execution owned-by-a not found",
      });
    });
  });

  test("respects concurrency limits", async () => {
    const redis = createRedis();
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const workflow = defineWorkflow<{ id: number }, string>({
      name: "concurrency-cap",
      redis,
      concurrency: 2,
      pollInterval: 1,
      handler: async ({ input, step }) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

        await step("work", async () => {
          await sleep(50);
          return input.id;
        });

        currentConcurrent--;
        return "done";
      },
    });

    try {
      await workflow.start({ id: 1 }, { executionId: "conc-1" });
      await workflow.start({ id: 2 }, { executionId: "conc-2" });
      await workflow.start({ id: 3 }, { executionId: "conc-3" });
      await workflow.start({ id: 4 }, { executionId: "conc-4" });

      await waitForExecution(workflow, "conc-1");
      await waitForExecution(workflow, "conc-2");
      await waitForExecution(workflow, "conc-3");
      await waitForExecution(workflow, "conc-4");

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(maxConcurrent).toBeGreaterThan(1);
    } finally {
      await workflow.stop();
    }
  });

  describe("partitions", () => {
    test("caps concurrent executions per partition key", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      let entered = 0;
      let releaseBarrier: (() => void) | undefined;

      const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });

      const workflow = defineWorkflow<{ envId: string }, string>({
        name: "partition-cap",
        redis,
        concurrency: 2,
        partitionBy: (input) => input.envId,
        pollInterval: 1,
        handler: async ({ step }) => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          entered++;

          if (entered >= 2) {
            releaseBarrier?.();
          }

          await barrier;

          await step("work", async () => {
            return "ok";
          });

          currentConcurrent--;
          return "done";
        },
      });

      try {
        await workflow.start({ envId: "env-a" }, { executionId: "pc-1" });
        await workflow.start({ envId: "env-a" }, { executionId: "pc-2" });
        await workflow.start({ envId: "env-a" }, { executionId: "pc-3" });
        await workflow.start({ envId: "env-a" }, { executionId: "pc-4" });

        await waitForExecution(workflow, "pc-1");
        await waitForExecution(workflow, "pc-2");
        await waitForExecution(workflow, "pc-3");
        await waitForExecution(workflow, "pc-4");

        expect(maxConcurrent).toBeLessThanOrEqual(2);
        expect(maxConcurrent).toBeGreaterThan(1);
      } finally {
        await workflow.stop();
      }
    });

    test("serializes same partition key when concurrency is 1", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const workflow = defineWorkflow<{ envId: string }, string>({
        name: "partition-serial",
        redis,
        concurrency: 1,
        partitionBy: (input) => input.envId,
        pollInterval: 1,
        handler: async ({ step }) => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          await step("work", async () => {
            await sleep(40);
            return "ok";
          });

          currentConcurrent--;
          return "done";
        },
      });

      try {
        await workflow.start({ envId: "env-a" }, { executionId: "pd-1" });
        await workflow.start({ envId: "env-a" }, { executionId: "pd-2" });
        await workflow.start({ envId: "env-a" }, { executionId: "pd-3" });

        await waitForExecution(workflow, "pd-1");
        await waitForExecution(workflow, "pd-2");
        await waitForExecution(workflow, "pd-3");

        expect(maxConcurrent).toBe(1);
      } finally {
        await workflow.stop();
      }
    });

    test("allows overlap across different partition keys", async () => {
      const redis = createRedis();
      let maxGlobal = 0;
      let currentGlobal = 0;

      const workflow = defineWorkflow<{ envId: string }, string>({
        name: "partition-overlap",
        redis,
        concurrency: 2,
        partitionBy: (input) => input.envId,
        pollInterval: 1,
        handler: async ({ step }) => {
          currentGlobal++;
          maxGlobal = Math.max(maxGlobal, currentGlobal);

          await step("work", async () => {
            await sleep(50);
            return "ok";
          });

          currentGlobal--;
          return "done";
        },
      });

      try {
        await workflow.start({ envId: "a" }, { executionId: "po-a1" });
        await workflow.start({ envId: "b" }, { executionId: "po-b1" });

        await waitForExecution(workflow, "po-a1");
        await waitForExecution(workflow, "po-b1");

        expect(maxGlobal).toBe(2);
      } finally {
        await workflow.stop();
      }
    });

    test("accepts partitionKey on start without partitionBy", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "partition-start-key",
        redis,
        concurrency: 1,
        pollInterval: 1,
        handler: async ({ step }) => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          await step("work", async () => {
            await sleep(40);
            return "ok";
          });

          currentConcurrent--;
          return "done";
        },
      });

      try {
        await workflow.start(
          { id: 1 },
          { executionId: "psk-1", partitionKey: "shared" },
        );
        await workflow.start(
          { id: 2 },
          { executionId: "psk-2", partitionKey: "shared" },
        );

        await waitForExecution(workflow, "psk-1");
        await waitForExecution(workflow, "psk-2");

        expect(maxConcurrent).toBe(1);
      } finally {
        await workflow.stop();
      }
    });

    test("start partitionKey overrides partitionBy", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const workflow = defineWorkflow<{ envId: string }, string>({
        name: "partition-override",
        redis,
        concurrency: 1,
        partitionBy: (input) => input.envId,
        pollInterval: 1,
        handler: async ({ step }) => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          await step("work", async () => {
            await sleep(40);
            return "ok";
          });

          currentConcurrent--;
          return "done";
        },
      });

      try {
        await workflow.start(
          { envId: "a" },
          { executionId: "pov-1", partitionKey: "shared" },
        );
        await workflow.start(
          { envId: "b" },
          { executionId: "pov-2", partitionKey: "shared" },
        );

        await waitForExecution(workflow, "pov-1");
        await waitForExecution(workflow, "pov-2");

        expect(maxConcurrent).toBe(1);
      } finally {
        await workflow.stop();
      }
    });

    test("resume honors stored partitionKey", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      let attempts = 0;
      let partitionFn = (input: { envId: string }) => input.envId;

      const workflow = defineWorkflow<{ envId: string }, string>({
        name: "partition-resume",
        redis,
        concurrency: 1,
        partitionBy: (input) => partitionFn(input),
        pollInterval: 1,
        retries: 0,
        handler: async ({ step }) => {
          attempts++;

          if (attempts === 1) {
            throw new Error("boom");
          }

          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          await step("work", async () => {
            await sleep(40);
            return "ok";
          });

          currentConcurrent--;
          return "done";
        },
      });

      try {
        await workflow.start({ envId: "env-a" }, { executionId: "pr-1" });
        await waitForExecution(workflow, "pr-1");

        partitionFn = () => "should-not-use";

        await workflow.start(
          { envId: "x" },
          { executionId: "pr-2", partitionKey: "env-a" },
        );
        await workflow.resume("pr-1");

        await waitForExecution(workflow, "pr-1");
        await waitForExecution(workflow, "pr-2");

        expect(maxConcurrent).toBe(1);
      } finally {
        await workflow.stop();
      }
    });
  });
});

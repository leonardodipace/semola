import { defineWorkflow as defineWorkflowActual } from "./index.js";
import type { WorkflowOptions } from "./types.js";

const defineWorkflow = <TInput, TResult = void>(
  options: WorkflowOptions<TInput, TResult>,
) => {
  return defineWorkflowActual<TInput, TResult>({
    recoveryIntervalMs: 0,
    ...options,
  });
};

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
      | "rpoplpush"
      | "lrem"
      | "lrange"
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

  public async rpoplpush(source: string, destination: string) {
    if (this.failCommands.has("rpoplpush")) {
      throw new Error("rpoplpush failed");
    }

    const value = await this.rpop(source);

    if (value === null) {
      return null;
    }

    if (!this.lists.has(destination)) {
      this.lists.set(destination, []);
    }

    this.lists.get(destination)?.unshift(value);

    return value;
  }

  public async lrem(key: string, count: number, value: string) {
    if (this.failCommands.has("lrem")) {
      throw new Error("lrem failed");
    }

    const list = this.lists.get(key);

    if (!list) {
      return 0;
    }

    let removed = 0;

    if (count === 0) {
      const next = list.filter((entry) => {
        if (entry === value) {
          removed++;
          return false;
        }

        return true;
      });

      this.lists.set(key, next);
      return removed;
    }

    if (count > 0) {
      const next: string[] = [];

      for (const entry of list) {
        if (entry === value && removed < count) {
          removed++;
          continue;
        }

        next.push(entry);
      }

      this.lists.set(key, next);
      return removed;
    }

    const next: string[] = [];
    const limit = Math.abs(count);

    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];

      if (entry === value && removed < limit) {
        removed++;
        continue;
      }

      next.unshift(entry ?? "");
    }

    this.lists.set(key, next);
    return removed;
  }

  public async lrange(key: string, start: number, stop: number) {
    if (this.failCommands.has("lrange")) {
      throw new Error("lrange failed");
    }

    const list = this.lists.get(key) ?? [];

    if (list.length === 0) {
      return [] as string[];
    }

    let from = start;
    let to = stop;

    if (from < 0) {
      from = list.length + from;
    }

    if (to < 0) {
      to = list.length + to;
    }

    if (from < 0) {
      from = 0;
    }

    if (to >= list.length) {
      to = list.length - 1;
    }

    if (from > to) {
      return [] as string[];
    }

    return list.slice(from, to + 1);
  }

  public seedList(key: string, values: string[]) {
    this.lists.set(key, [...values]);
  }

  public getList(key: string) {
    return [...(this.lists.get(key) ?? [])];
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
    recoveryIntervalMs: 0,
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
    recoveryIntervalMs: 0,
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

export {
  MockRedisClient,
  createRedis,
  createTwoStepFailResumeWorkflow,
  createWorkflowWithEchoResult,
  defineWorkflow,
  fastRetryBackoff,
  sleep,
  waitForExecution,
  waitForHsetFailure,
  waitForStatus,
};

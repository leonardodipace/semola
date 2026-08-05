import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  DuplicateWorkflowError,
  NonRetryableStepError,
  NotFoundError,
  SerializationError,
  WorkflowStoreError,
} from "./errors.js";
import { defineWorkflow } from "./index.js";
import type { Workflow } from "./types.js";

type ZMember = { score: number; member: string };

class MockRedisClient {
  private strings = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();
  private hashes = new Map<string, Map<string, string>>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private zsets = new Map<string, ZMember[]>();

  private isExpired(key: string) {
    const entry = this.strings.get(key);

    if (!entry) return true;

    if (entry.expiresAt === null) return false;

    if (Date.now() >= entry.expiresAt) {
      this.strings.delete(key);
      return true;
    }

    return false;
  }

  public async get(key: string) {
    if (this.isExpired(key)) return null;

    return this.strings.get(key)?.value ?? null;
  }

  public async set(
    key: string,
    value: string,
    mode?: string,
    ttl?: string | number,
    flag?: string,
  ) {
    const args = [mode, ttl, flag].filter((v) => v !== undefined).map(String);
    const nx = args.includes("NX");
    const pxIndex = args.indexOf("PX");

    let ttlMs: number | null = null;

    if (pxIndex >= 0) {
      ttlMs = Number(args[pxIndex + 1]);
    }

    if (nx) {
      if (!this.isExpired(key)) {
        if (this.strings.has(key)) {
          return null;
        }
      }
    }

    let expiresAt: number | null = null;

    if (ttlMs !== null) {
      expiresAt = Date.now() + ttlMs;
    }

    this.strings.set(key, {
      value,
      expiresAt,
    });

    return "OK";
  }

  public async del(...keys: string[]) {
    let count = 0;

    for (const key of keys) {
      if (this.strings.delete(key)) count++;
      if (this.hashes.delete(key)) count++;
      if (this.lists.delete(key)) count++;
      if (this.sets.delete(key)) count++;
      if (this.zsets.delete(key)) count++;
    }

    return count;
  }

  public async pexpire(key: string, ttlMs: number) {
    const entry = this.strings.get(key);

    if (!entry) return 0;

    if (this.isExpired(key)) return 0;

    entry.expiresAt = Date.now() + ttlMs;
    return 1;
  }

  public async pttl(key: string) {
    const entry = this.strings.get(key);

    if (!entry) return -2;

    if (entry.expiresAt === null) return -1;

    if (Date.now() >= entry.expiresAt) {
      this.strings.delete(key);
      return -2;
    }

    return entry.expiresAt - Date.now();
  }

  public async lpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];

    for (const value of values) {
      list.unshift(value);
    }

    this.lists.set(key, list);
    return list.length;
  }

  public async rpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];

    for (const value of values) {
      list.push(value);
    }

    this.lists.set(key, list);
    return list.length;
  }

  public async rpop(key: string) {
    const list = this.lists.get(key);

    if (!list) return null;

    if (list.length === 0) return null;

    return list.pop() ?? null;
  }

  public async lrange(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];

    let end = stop + 1;

    if (stop < 0) {
      end = list.length + stop + 1;
    }

    return list.slice(start, end);
  }

  public async hset(key: string, ...fieldValues: string[]) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();

    for (let i = 0; i < fieldValues.length; i += 2) {
      const field = fieldValues[i];
      const value = fieldValues[i + 1];

      if (field === undefined) continue;

      if (value === undefined) continue;

      hash.set(field, value);
    }

    this.hashes.set(key, hash);
    return fieldValues.length / 2;
  }

  public async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  public async hgetall(key: string) {
    const hash = this.hashes.get(key);

    if (!hash) return {};

    return Object.fromEntries(hash.entries());
  }

  public async sadd(key: string, ...members: string[]) {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;

    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }

    this.sets.set(key, set);
    return added;
  }

  public async srem(key: string, ...members: string[]) {
    const set = this.sets.get(key);

    if (!set) return 0;

    let removed = 0;

    for (const member of members) {
      if (set.delete(member)) removed++;
    }

    return removed;
  }

  public async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }

  public async zadd(key: string, score: number, member: string) {
    const zset = this.zsets.get(key) ?? [];
    const existing = zset.findIndex((row) => row.member === member);

    if (existing >= 0) {
      zset[existing] = { score, member };
    } else {
      zset.push({ score, member });
    }

    this.zsets.set(key, zset);
    return 1;
  }

  public async zrangebyscore(key: string, min: number, max: number) {
    const zset = this.zsets.get(key) ?? [];

    return zset
      .filter((row) => row.score >= min && row.score <= max)
      .sort((a, b) => a.score - b.score)
      .map((row) => row.member);
  }

  public async zrem(key: string, ...members: string[]) {
    const zset = this.zsets.get(key) ?? [];
    const next = zset.filter((row) => !members.includes(row.member));
    const removed = zset.length - next.length;

    this.zsets.set(key, next);
    return removed;
  }

  public async send(command: string, args: string[]) {
    if (command === "RPUSH") {
      const [key, ...values] = args;

      return this.rpush(key ?? "", ...values);
    }

    if (command === "HSET") {
      const [key, ...fieldValues] = args;

      return this.hset(key ?? "", ...fieldValues);
    }

    if (command === "HSETNX") {
      const key = args[0] ?? "";
      const field = args[1] ?? "";
      const value = args[2] ?? "";
      const hash = this.hashes.get(key) ?? new Map<string, string>();

      if (hash.has(field)) return 0;

      hash.set(field, value);
      this.hashes.set(key, hash);
      return 1;
    }

    if (command !== "EVAL") {
      throw new Error(`Unsupported command ${command}`);
    }

    const script = args[0] ?? "";
    const key = args[2] ?? "";
    const token = args[3] ?? "";

    if (script.includes("ZRANGEBYSCORE")) {
      const now = Number(args[3]);
      const members = await this.zrangebyscore(key, 0, now);
      const member = members[0];

      if (!member) return false;

      await this.zrem(key, member);
      return member;
    }

    if (script.includes("EXISTS")) {
      if (this.hashes.has(key)) return 0;

      await this.hset(key, ...args.slice(3));
      return 1;
    }

    if (script.includes("DEL")) {
      const current = await this.get(key);

      if (current !== token) return 0;

      await this.del(key);
      return 1;
    }

    if (script.includes("PEXPIRE")) {
      const current = await this.get(key);

      if (current !== token) return 0;

      return this.pexpire(key, Number(args[4]));
    }

    return 0;
  }

  public expireLeaseNow(key: string) {
    const entry = this.strings.get(key);

    if (entry) {
      entry.expiresAt = Date.now() - 1;
    }
  }

  public clearZset(key: string) {
    this.zsets.delete(key);
  }

  public getStringKeys() {
    return [...this.strings.keys()];
  }
}

const createRedis = () =>
  new MockRedisClient() as MockRedisClient & Bun.RedisClient;

// Bun does not expose Jest 29.5 `*Async` timer APIs. Polyfill the ones we need.
const runOnlyPendingTimersAsync = async () => {
  jest.runOnlyPendingTimers();
  await Promise.resolve();
};

let advancing = false;

const advanceTimersByTimeAsync = async (ms: number) => {
  // Nested waits (hang loops) just park on setTimeout; outer advance owns the clock.
  if (advancing) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }

  advancing = true;

  try {
    const done = new Promise<void>((resolve) => setTimeout(resolve, ms));
    const end = Date.now() + ms;

    while (Date.now() < end) {
      if (jest.getTimerCount() === 0) {
        jest.advanceTimersByTime(end - Date.now());
        break;
      }

      await runOnlyPendingTimersAsync();
    }

    await done;
  } finally {
    advancing = false;
  }
};

const sleep = advanceTimersByTimeAsync;

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
) => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;

    await advanceTimersByTimeAsync(5);
  }

  throw new Error("waitFor timeout");
};

const waitStatus = async <TInput, TResult>(
  wf: Workflow<TInput, TResult>,
  executionId: string,
  status: string,
  timeoutMs = 3000,
) => {
  await waitFor(async () => {
    const execution = await wf.get(executionId);
    return execution.status === status;
  }, timeoutMs);

  return wf.get(executionId);
};

const stop = async (wf: { stop: () => Promise<void> }) => {
  const done = wf.stop();
  await advanceTimersByTimeAsync(100);
  await done;
};

const expireLeases = (redis: MockRedisClient) => {
  for (const key of redis.getStringKeys()) {
    if (key.includes(":lease:")) redis.expireLeaseNow(key);
  }
};

const fast = {
  pollInterval: 5,
  lockTTL: 40,
  retryBackoff: { baseDelay: 5, multiplier: 2, maxDelay: 20 },
};

describe("workflow-v2", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("happy path multi-step completes", async () => {
    const redis = createRedis();
    const calls: string[] = [];

    const wf = defineWorkflow<{ value: number }, number>({
      name: `happy-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: async ({ input, step }) => {
        const a = await step("double", async () => {
          calls.push("double");
          return input.value * 2;
        });

        const b = await step("add", async () => {
          calls.push("add");
          return a + 1;
        });

        return b;
      },
    });

    const { executionId } = await wf.start({ value: 21 });
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe(43);
    expect(execution.steps.map((s) => s.name)).toEqual(["double", "add"]);
    expect(calls).toEqual(["double", "add"]);

    await stop(wf);
  });

  test("completed step not re-executed on reclaim", async () => {
    const redis = createRedis();
    const counts = { first: 0, second: 0 };
    const name = `persist-${crypto.randomUUID()}`;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL: 40,
        handler: async ({ step }) => {
          await step("first", async () => {
            counts.first++;
            await sleep(25);
            return 1;
          });

          await step("second", async () => {
            counts.second++;
            return 2;
          });

          return "ok";
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await waitFor(() => counts.first === 1);

    expireLeases(redis);

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(counts.first).toBeGreaterThanOrEqual(1);
    expect(counts.second).toBe(1);

    await stop(wf2);
  });

  test("crash mid-activity re-executes then continues", async () => {
    const redis = createRedis();
    let attempts = 0;
    const name = `crash-act-${crypto.randomUUID()}`;
    let hangFirst = true;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL: 60,
        handler: async ({ step }) => {
          await step("fragile", async ({ signal }) => {
            attempts++;

            if (hangFirst) {
              hangFirst = false;

              while (!signal.aborted) {
                await sleep(10);
              }

              throw new Error("crashed");
            }

            return "done";
          });

          return attempts;
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await waitFor(() => attempts === 1);
    await sleep(15);

    expireLeases(redis);

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(execution.status).toBe("completed");

    await stop(wf2);
  });

  test("multi-worker concurrency drains without double-complete", async () => {
    const redis = createRedis();
    let runs = 0;

    const wf = defineWorkflow({
      name: `multi-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 3,
      handler: async ({ step }) => {
        const value = await step("work", async () => {
          runs++;
          await sleep(20);
          return 1;
        });

        return value;
      },
    });

    const started = await Promise.all([
      wf.start({}),
      wf.start({}),
      wf.start({}),
      wf.start({}),
    ]);

    for (const { executionId } of started) {
      await waitStatus(wf, executionId, "completed");
    }

    expect(runs).toBe(4);

    await stop(wf);
  });

  test("two sequential replicas share redis without double-complete", async () => {
    const redis = createRedis();
    const name = `replica-${crypto.randomUUID()}`;
    let runs = 0;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        handler: async ({ step }) => {
          await step("work", async () => {
            runs++;
            return 1;
          });
          return "ok";
        },
      });

    const wf1 = make();
    const first = await wf1.start({});
    await waitStatus(wf1, first.executionId, "completed");
    await stop(wf1);

    const wf2 = make();
    const second = await wf2.start({});
    await waitStatus(wf2, second.executionId, "completed");

    expect(runs).toBe(2);

    await stop(wf2);
  });

  test("lease expiry auto-reclaims without resume", async () => {
    const redis = createRedis();
    const name = `reclaim-${crypto.randomUUID()}`;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL: 50,
        handler: async ({ step, sleep: durableSleep }) => {
          await durableSleep(5);
          await step("finish", async () => "done");
          return "ok";
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await sleep(25);
    expireLeases(redis);

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(execution.result).toBe("ok");

    await stop(wf2);
  });

  test("retries backoff then failed", async () => {
    const redis = createRedis();
    let attempts = 0;
    const retriesSeen: number[] = [];
    const remainingSeen: number[] = [];

    const wf = defineWorkflow({
      name: `retry-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 2,
      hooks: {
        onRetry: (ctx) => {
          retriesSeen.push(ctx.attempt);
          remainingSeen.push(ctx.retriesRemaining);
        },
      },
      handler: async ({ step }) => {
        await step("flaky", async () => {
          attempts++;
          throw new Error("boom");
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toContain("boom");
    expect(attempts).toBe(3);
    expect(retriesSeen.length).toBe(2);
    expect(remainingSeen).toEqual([2, 1]);

    await stop(wf);
  });

  test("reclaim restores activity retry after timer drop", async () => {
    const redis = createRedis();
    const name = `retry-reclaim-${crypto.randomUUID()}`;
    let attempts = 0;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL: 50,
        retries: 2,
        retryBackoff: { baseDelay: 10_000, multiplier: 1, maxDelay: 10_000 },
        handler: async ({ step }) => {
          await step("flaky", async () => {
            attempts++;
            if (attempts < 2) throw new Error("boom");
            return "ok";
          });
          return "done";
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await waitFor(() => attempts >= 1, 2000);
    await sleep(15);
    redis.clearZset(`workflow-v2:${name}:timers`);

    expireLeases(redis);

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(execution.result).toBe("done");
    expect(attempts).toBe(2);

    await stop(wf2);
  });

  test("fail() is non-retryable", async () => {
    const redis = createRedis();
    let attempts = 0;

    const wf = defineWorkflow({
      name: `fail-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 5,
      handler: async ({ step }) => {
        await step("nope", async ({ fail }) => {
          attempts++;
          fail("hard stop");
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("hard stop");
    expect(attempts).toBe(1);

    await stop(wf);
  });

  test("cancel during run", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `cancel-run-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: async ({ step, signal }) => {
        await step("long", async () => {
          await sleep(20);

          if (signal.aborted) {
            throw new NonRetryableStepError("aborted");
          }

          return 1;
        });
      },
    });

    const { executionId } = await wf.start({});
    await sleep(20);
    const cancelResult = await wf.cancel(executionId);

    expect(cancelResult.status).not.toBe("cancelled");

    const execution = await waitStatus(wf, executionId, "cancelled");
    expect(execution.status).toBe("cancelled");

    await stop(wf);
  });

  test("cancel during retry wait", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `cancel-retry-${crypto.randomUUID()}`,
      redis,
      pollInterval: 5,
      lockTTL: 40,
      retries: 5,
      retryBackoff: { baseDelay: 30, multiplier: 2, maxDelay: 60 },
      handler: async ({ step }) => {
        await step("flaky", async () => {
          throw new Error("again");
        });
      },
    });

    const { executionId } = await wf.start({});
    await sleep(20);
    await wf.cancel(executionId);

    const execution = await waitStatus(wf, executionId, "cancelled");
    expect(execution.status).toBe("cancelled");

    await stop(wf);
  });

  test("partitionBy concurrency cap", async () => {
    const redis = createRedis();
    let concurrent = 0;
    let maxConcurrent = 0;

    const wf = defineWorkflow<{ key: string }, boolean>({
      name: `part-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      partitionBy: (input) => input.key,
      handler: async ({ step }) => {
        await step("work", async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(20);
          concurrent--;
          return true;
        });

        return true;
      },
    });

    const starts = await Promise.all([
      wf.start({ key: "same" }),
      wf.start({ key: "same" }),
      wf.start({ key: "same" }),
    ]);

    for (const { executionId } of starts) {
      await waitStatus(wf, executionId, "completed");
    }

    expect(maxConcurrent).toBe(1);

    await stop(wf);
  });

  test("custom serializers", async () => {
    const redis = createRedis();

    const wf = defineWorkflow<{ n: number }, { n: number }>({
      name: `ser-${crypto.randomUUID()}`,
      redis,
      ...fast,
      serializeInput: (value) => `i:${value.n}`,
      deserializeInput: (raw) => ({ n: Number(raw.slice(2)) }),
      serializeResult: (value) => `r:${value.n}`,
      deserializeResult: (raw) => ({ n: Number(raw.slice(2)) }),
      serializeStepOutput: (value) => `s:${value}`,
      deserializeStepOutput: (raw) => Number(raw.slice(2)),
      handler: async ({ input, step }) => {
        const doubled = await step("d", async () => input.n * 2);
        return { n: doubled as number };
      },
    });

    const { executionId } = await wf.start({ n: 4 });
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toEqual({ n: 8 });

    await stop(wf);
  });

  test("duplicate workflow name throws", async () => {
    const redis = createRedis();
    const name = `dup-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      handler: async () => {},
    });

    expect(() =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        handler: async () => {},
      }),
    ).toThrow(DuplicateWorkflowError);

    await stop(wf);
  });

  test("durable sleep survives crash", async () => {
    const redis = createRedis();
    const name = `sleep-${crypto.randomUUID()}`;
    let finished = 0;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL: 50,
        handler: async ({ sleep: durableSleep, step }) => {
          await durableSleep(10);
          await step("after", async () => {
            finished++;
            return true;
          });
          return "slept";
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await sleep(20);

    expireLeases(redis);

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(execution.result).toBe("slept");
    expect(finished).toBe(1);

    await stop(wf2);
  });

  test("reclaim re-enqueues scheduled activity after queue drop", async () => {
    const redis = createRedis();
    const name = `sched-stuck-${crypto.randomUUID()}`;
    const executionId = crypto.randomUUID();
    const now = Date.now();
    let runs = 0;

    await redis.rpush(
      `workflow-v2:${name}:history:${executionId}`,
      JSON.stringify({
        type: "WorkflowExecutionStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "ActivityTaskScheduled",
        activityId: "a0",
        stepName: "only",
        attempt: 1,
        timestamp: now,
      }),
    );

    await redis.hset(
      `workflow-v2:${name}:meta:${executionId}`,
      "name",
      name,
      "status",
      "running",
      "input",
      "{}",
      "result",
      "",
      "error",
      "",
      "createdAt",
      String(now),
      "updatedAt",
      String(now),
      "completedAt",
      "",
      "failedAt",
      "",
      "cancelledAt",
      "",
      "steps",
      "[]",
      "partitionKey",
      "",
    );

    await redis.sadd(`workflow-v2:${name}:active`, executionId);

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      lockTTL: 60,
      handler: async ({ step }) => {
        const value = await step("only", async () => {
          runs++;
          return "ok";
        });

        return value;
      },
    });

    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(runs).toBe(1);

    await stop(wf);
  });

  test("resume failed execution", async () => {
    const redis = createRedis();
    let attempts = 0;
    let starts = 0;

    const wf = defineWorkflow({
      name: `resume-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      hooks: {
        onStart: () => {
          starts++;
        },
      },
      handler: async ({ step }) => {
        const value = await step("once", async () => {
          attempts++;

          if (attempts === 1) throw new Error("boom");

          return "ok";
        });

        return value;
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    await wf.resume(executionId);
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(attempts).toBe(2);
    expect(starts).toBe(1);

    await stop(wf);
  });

  test("resume clears sticky cancel after fail race", async () => {
    const redis = createRedis();
    let attempts = 0;
    const name = `resume-cancel-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        const value = await step("once", async () => {
          attempts++;

          if (attempts === 1) throw new Error("boom");

          return "ok";
        });

        return value;
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    await redis.rpush(
      `workflow-v2:${name}:history:${executionId}`,
      JSON.stringify({
        type: "WorkflowExecutionCancelRequested",
        timestamp: Date.now(),
      }),
    );

    await wf.resume(executionId);
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(execution.status).toBe("completed");

    await stop(wf);
  });

  test("stop drains and stops polling", async () => {
    const redis = createRedis();
    const name = `stop-${crypto.randomUUID()}`;
    let started = 0;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      handler: async ({ step }) => {
        await step("work", async () => {
          started++;
          await sleep(15);
          return 1;
        });
      },
    });

    const { executionId } = await wf.start({});
    await waitFor(() => started === 1);
    await stop(wf);

    const execution = await wf.get(executionId);
    expect(["completed", "running", "pending"]).toContain(execution.status);

    const wf2 = defineWorkflow({
      name,
      redis,
      ...fast,
      handler: async () => "x",
    });

    await stop(wf2);
  });

  describe("api edges", () => {
    test("get returns not found on unknown execution", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `missing-get-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await expect(wf.get("unknown")).rejects.toMatchObject({
        name: "NotFoundError",
        message: "Workflow execution unknown not found",
      });

      await stop(wf);
    });

    test("cancel returns not found on unknown execution", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `missing-cancel-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await expect(wf.cancel("nonexistent")).rejects.toBeInstanceOf(
        NotFoundError,
      );

      await stop(wf);
    });

    test("resume returns not found on unknown execution", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `missing-resume-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await expect(wf.resume("nonexistent")).rejects.toBeInstanceOf(
        NotFoundError,
      );

      await stop(wf);
    });

    test("rejects duplicate execution ids", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `dupe-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await wf.start({}, { executionId: "exec-1" });

      await expect(
        wf.start({}, { executionId: "exec-1" }),
      ).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: "Workflow execution exec-1 already exists",
      });

      await stop(wf);
    });

    test("rejects concurrent duplicate custom execution ids", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `race-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      const results = await Promise.allSettled([
        wf.start({}, { executionId: "exec-race" }),
        wf.start({}, { executionId: "exec-race" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const failure = rejected[0];

      if (!failure || failure.status !== "rejected") {
        throw new Error("expected one start to reject");
      }

      expect(failure.reason).toBeInstanceOf(WorkflowStoreError);

      await stop(wf);
    });

    test("cancel on completed returns terminal status", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `cancel-done-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "done",
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "completed");

      const cancelled = await wf.cancel(executionId);

      expect(cancelled.status).toBe("completed");
      expect(cancelled.executionId).toBe(executionId);

      await stop(wf);
    });

    test("cancel on cancelled returns terminal status", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `cancel-twice-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ step }) => {
          await step("long", async ({ signal }) => {
            await sleep(20);

            if (signal.aborted) {
              throw new NonRetryableStepError("aborted");
            }

            return "ok";
          });
        },
      });

      const { executionId } = await wf.start({});
      await sleep(20);
      await wf.cancel(executionId);
      await waitStatus(wf, executionId, "cancelled");

      const second = await wf.cancel(executionId);

      expect(second.status).toBe("cancelled");
      expect(second.executionId).toBe(executionId);

      await stop(wf);
    });

    test("resume rejects non-failed executions", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `resume-rules-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "done",
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "completed");

      await expect(wf.resume(executionId)).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: expect.stringContaining(
          "only failed executions can be resumed",
        ),
      });

      await stop(wf);
    });

    test("get returns error and failedAt on failed workflow", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `get-failed-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("boom", async () => {
            throw new Error("something went wrong");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("something went wrong");
      expect(typeof execution.failedAt).toBe("number");
      expect(execution.completedAt).toBeNull();
      expect(execution.cancelledAt).toBeNull();

      await stop(wf);
    });

    test("get returns cancelledAt on cancelled workflow", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `get-cancelled-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ step }) => {
          await step("long", async ({ signal }) => {
            await sleep(20);

            if (signal.aborted) {
              throw new NonRetryableStepError("aborted");
            }

            return "ok";
          });
        },
      });

      const { executionId } = await wf.start({});
      await sleep(20);
      await wf.cancel(executionId);

      const execution = await waitStatus(wf, executionId, "cancelled");

      expect(typeof execution.cancelledAt).toBe("number");
      expect(execution.completedAt).toBeNull();

      await stop(wf);
    });
  });

  describe("hooks and retries", () => {
    test("retries step after transient failure then succeeds", async () => {
      const redis = createRedis();
      let stepAttempts = 0;

      const wf = defineWorkflow({
        name: `retry-ok-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 2,
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

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("done");
      expect(stepAttempts).toBe(3);

      await stop(wf);
    });

    test("calls onRetry with correct context", async () => {
      const redis = createRedis();
      const retryContexts: Array<{
        stepName: string;
        attempt: number;
        nextRetryDelayMs: number;
        retriesRemaining: number;
      }> = [];

      const wf = defineWorkflow({
        name: `on-retry-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 2,
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
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      expect(retryContexts.length).toBe(2);
      expect(retryContexts[0]?.stepName).toBe("flaky");
      expect(retryContexts[0]?.attempt).toBe(1);
      expect(retryContexts[0]?.nextRetryDelayMs).toBe(5);
      expect(retryContexts[0]?.retriesRemaining).toBe(2);
      expect(retryContexts[1]?.attempt).toBe(2);
      expect(retryContexts[1]?.nextRetryDelayMs).toBe(10);
      expect(retryContexts[1]?.retriesRemaining).toBe(1);

      await stop(wf);
    });

    test("calls onError when retries are exhausted", async () => {
      const redis = createRedis();
      const errorContexts: Array<{
        stepName: string;
        totalAttempts: number;
        errorHistoryLength: number;
      }> = [];

      const wf = defineWorkflow({
        name: `on-error-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 1,
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
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.status).toBe("failed");
      expect(errorContexts.length).toBe(1);
      expect(errorContexts[0]?.stepName).toBe("flaky");
      expect(errorContexts[0]?.totalAttempts).toBe(2);
      expect(errorContexts[0]?.errorHistoryLength).toBe(2);

      await stop(wf);
    });

    test("fail() calls onError and skips onRetry", async () => {
      const redis = createRedis();
      let onRetryCalls = 0;
      const errorContexts: Array<{
        stepName: string;
        error: string;
        totalAttempts: number;
      }> = [];

      const wf = defineWorkflow({
        name: `fail-hooks-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 3,
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
            fail("permanent");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("permanent");
      expect(onRetryCalls).toBe(0);
      expect(errorContexts.length).toBe(1);
      expect(errorContexts[0]?.stepName).toBe("risky");
      expect(errorContexts[0]?.error).toBe("permanent");
      expect(errorContexts[0]?.totalAttempts).toBe(1);

      await stop(wf);
    });

    test("calls lifecycle hooks on start, complete, and cancel", async () => {
      const redis = createRedis();
      const events: string[] = [];

      const wfCancel = defineWorkflow({
        name: `lifecycle-cancel-${crypto.randomUUID()}`,
        redis,
        ...fast,
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
        handler: async ({ step }) => {
          await step("long", async ({ signal }) => {
            await sleep(20);

            if (signal.aborted) {
              throw new NonRetryableStepError("aborted");
            }

            return "ok";
          });
        },
      });

      const { executionId: cancelId } = await wfCancel.start({});
      await sleep(20);
      await wfCancel.cancel(cancelId);
      await waitStatus(wfCancel, cancelId, "cancelled");

      expect(events).toEqual(["start", "cancel"]);

      await stop(wfCancel);
      events.length = 0;

      const wfComplete = defineWorkflow({
        name: `lifecycle-complete-${crypto.randomUUID()}`,
        redis,
        ...fast,
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

      const { executionId } = await wfComplete.start({});
      await waitStatus(wfComplete, executionId, "completed");

      expect(events).toEqual(["start", "complete"]);

      await stop(wfComplete);
    });

    test("hook errors do not fail the workflow", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `hook-throw-${crypto.randomUUID()}`,
        redis,
        ...fast,
        hooks: {
          onStart: () => {
            throw new Error("hook boom");
          },
          onComplete: () => {
            throw new Error("complete boom");
          },
        },
        handler: async () => "done",
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("done");

      await stop(wf);
    });

    test("does not call onRetry when step succeeds on first try", async () => {
      const redis = createRedis();
      let onRetryCalls = 0;

      const wf = defineWorkflow({
        name: `no-retry-${crypto.randomUUID()}`,
        redis,
        ...fast,
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

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "completed");

      expect(onRetryCalls).toBe(0);

      await stop(wf);
    });
  });

  describe("falsy step outputs", () => {
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

        const wf = defineWorkflow<{ id: number }, unknown>({
          name: `falsy-${label}-${crypto.randomUUID()}`,
          redis,
          ...fast,
          retries: 0,
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

        const { executionId } = await wf.start({ id: 1 });
        await waitStatus(wf, executionId, "failed");

        expect(stepRuns).toBe(1);

        await wf.resume(executionId);
        const execution = await waitStatus(wf, executionId, "completed");

        expect(execution.result).toStrictEqual(value);
        expect(stepRuns).toBe(1);

        await stop(wf);
      });
    }
  });

  describe("serializer failures", () => {
    test("returns serialization error when input serializer throws", async () => {
      const redis = createRedis();

      const wf = defineWorkflow<{ id: number }, string>({
        name: `ser-input-err-${crypto.randomUUID()}`,
        redis,
        ...fast,
        serializeInput: () => {
          throw new Error("cannot serialize");
        },
        handler: async () => "ok",
      });

      await expect(wf.start({ id: 1 })).rejects.toMatchObject({
        name: "SerializationError",
        message: "Unable to serialize input",
      });

      await stop(wf);
    });

    test("returns serialization error when result deserializer throws", async () => {
      const redis = createRedis();
      let shouldThrow = false;

      const wf = defineWorkflow<{ id: number }, string>({
        name: `deser-result-err-${crypto.randomUUID()}`,
        redis,
        ...fast,
        serializeResult: () => "custom-format",
        deserializeResult: () => {
          if (shouldThrow) {
            throw new Error("cannot deserialize");
          }

          return "done";
        },
        handler: async () => "done",
      });

      const { executionId } = await wf.start({ id: 1 });
      await waitStatus(wf, executionId, "completed");

      shouldThrow = true;

      await expect(wf.get(executionId)).rejects.toBeInstanceOf(
        SerializationError,
      );

      await stop(wf);
    });
  });

  describe("partitions", () => {
    test("accepts partitionKey on start without partitionBy", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const wf = defineWorkflow<{ id: number }, string>({
        name: `psk-${crypto.randomUUID()}`,
        redis,
        ...fast,
        concurrency: 1,
        handler: async ({ step }) => {
          await step("work", async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await sleep(20);
            currentConcurrent--;
            return "ok";
          });

          return "done";
        },
      });

      await wf.start(
        { id: 1 },
        { executionId: "psk-1", partitionKey: "shared" },
      );
      await wf.start(
        { id: 2 },
        { executionId: "psk-2", partitionKey: "shared" },
      );

      await waitStatus(wf, "psk-1", "completed");
      await waitStatus(wf, "psk-2", "completed");

      expect(maxConcurrent).toBe(1);

      await stop(wf);
    });

    test("start partitionKey overrides partitionBy", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const wf = defineWorkflow<{ envId: string }, string>({
        name: `pov-${crypto.randomUUID()}`,
        redis,
        ...fast,
        concurrency: 1,
        partitionBy: (input) => input.envId,
        handler: async ({ step }) => {
          await step("work", async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await sleep(20);
            currentConcurrent--;
            return "ok";
          });

          return "done";
        },
      });

      await wf.start(
        { envId: "a" },
        { executionId: "pov-1", partitionKey: "shared" },
      );
      await wf.start(
        { envId: "b" },
        { executionId: "pov-2", partitionKey: "shared" },
      );

      await waitStatus(wf, "pov-1", "completed");
      await waitStatus(wf, "pov-2", "completed");

      expect(maxConcurrent).toBe(1);

      await stop(wf);
    });

    test("rejects empty partition key", async () => {
      const redis = createRedis();

      const wf = defineWorkflow<{ key: string }, string>({
        name: `empty-pk-${crypto.randomUUID()}`,
        redis,
        ...fast,
        partitionBy: (input) => input.key,
        handler: async () => "done",
      });

      await expect(wf.start({ key: "" })).rejects.toBeInstanceOf(
        WorkflowStoreError,
      );

      await expect(
        wf.start({ key: "x" }, { partitionKey: "" }),
      ).rejects.toBeInstanceOf(WorkflowStoreError);

      await stop(wf);
    });

    test("allows overlap across different partition keys", async () => {
      const redis = createRedis();
      let maxGlobal = 0;
      let currentGlobal = 0;

      const wf = defineWorkflow<{ envId: string }, string>({
        name: `po-${crypto.randomUUID()}`,
        redis,
        ...fast,
        concurrency: 2,
        partitionBy: (input) => input.envId,
        handler: async ({ step }) => {
          await step("work", async () => {
            currentGlobal++;
            maxGlobal = Math.max(maxGlobal, currentGlobal);
            await sleep(20);
            currentGlobal--;
            return "ok";
          });

          return "done";
        },
      });

      await wf.start({ envId: "a" }, { executionId: "po-a1" });
      await wf.start({ envId: "b" }, { executionId: "po-b1" });

      await waitStatus(wf, "po-a1", "completed");
      await waitStatus(wf, "po-b1", "completed");

      expect(maxGlobal).toBe(2);

      await stop(wf);
    });

    test("resume honors stored partitionKey", async () => {
      const redis = createRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      let attempts = 0;
      let partitionFn = (input: { envId: string }) => input.envId;

      const wf = defineWorkflow<{ envId: string }, string>({
        name: `pr-${crypto.randomUUID()}`,
        redis,
        ...fast,
        concurrency: 1,
        partitionBy: (input) => partitionFn(input),
        retries: 0,
        handler: async ({ step }) => {
          await step("gate", async () => {
            attempts++;

            if (attempts === 1) {
              throw new Error("boom");
            }

            return "ok";
          });

          await step("work", async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await sleep(20);
            currentConcurrent--;
            return "ok";
          });

          return "done";
        },
      });

      await wf.start({ envId: "env-a" }, { executionId: "pr-1" });
      await waitStatus(wf, "pr-1", "failed");

      partitionFn = () => "should-not-use";

      await wf.start(
        { envId: "x" },
        { executionId: "pr-2", partitionKey: "env-a" },
      );
      await wf.resume("pr-1");

      await waitStatus(wf, "pr-1", "completed");
      await waitStatus(wf, "pr-2", "completed");

      expect(maxConcurrent).toBe(1);

      await stop(wf);
    });
  });

  describe("abort signal", () => {
    test("signal is aborted when step detects cancellation", async () => {
      const redis = createRedis();
      let signalAborted = false;

      const wf = defineWorkflow({
        name: `abort-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ executionId, step, signal }) => {
          signal.addEventListener("abort", () => {
            signalAborted = true;
          });

          await step("cancel-self", async () => {
            await wf.cancel(executionId);
            return "ok";
          });

          await step("detect-cancel", async () => "ok");

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "cancelled");

      expect(signalAborted).toBe(true);

      await stop(wf);
    });
  });

  describe("v2-specific", () => {
    test("nondeterminism fails when step name mismatches history", async () => {
      const redis = createRedis();
      let useAltName = false;

      const wf = defineWorkflow({
        name: `nondet-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step(useAltName ? "beta" : "alpha", async () => "cached");

          if (!useAltName) {
            useAltName = true;
            throw new Error("fail after step");
          }

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await wf.resume(executionId);
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toContain("nondeterminism");

      await stop(wf);
    });

    test("nondeterminism fails when step removed from history", async () => {
      const redis = createRedis();
      let dropSecond = false;

      const wf = defineWorkflow({
        name: `nondet-rm-step-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("a", async () => "1");

          if (!dropSecond) {
            await step("b", async () => "2");
            dropSecond = true;
            throw new Error("fail after steps");
          }

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await wf.resume(executionId);
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toContain("nondeterminism");
      expect(execution.error).toContain("historical activity");

      await stop(wf);
    });

    test("nondeterminism fails when timer removed from history", async () => {
      const redis = createRedis();
      let dropSleep = false;

      const wf = defineWorkflow({
        name: `nondet-rm-timer-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step, sleep: durableSleep }) => {
          await step("a", async () => "1");

          if (!dropSleep) {
            await durableSleep(5);
            dropSleep = true;
            throw new Error("fail after sleep");
          }

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await wf.resume(executionId);
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toContain("nondeterminism");
      expect(execution.error).toContain("historical timer");

      await stop(wf);
    });

    test("nondeterminism fails when sleep delay changes", async () => {
      const redis = createRedis();
      let longer = false;

      const wf = defineWorkflow({
        name: `nondet-delay-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ sleep: durableSleep }) => {
          await durableSleep(longer ? 100 : 5);

          if (!longer) {
            longer = true;
            throw new Error("fail after sleep");
          }

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await wf.resume(executionId);
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toContain("nondeterminism");
      expect(execution.error).toContain("expected delay");

      await stop(wf);
    });

    test("onComplete fires once across reclaim replay", async () => {
      const redis = createRedis();
      const name = `hook-replay-${crypto.randomUUID()}`;
      let completes = 0;
      let release = false;

      const make = () =>
        defineWorkflow({
          name,
          redis,
          ...fast,
          lockTTL: 40,
          hooks: {
            onComplete: () => {
              completes++;
            },
          },
          handler: async ({ step }) => {
            await step("first", async () => "ok");

            await step("second", async ({ signal }) => {
              while (!release && !signal.aborted) {
                await sleep(10);
              }

              return "ok";
            });

            return "done";
          },
        });

      const wf1 = make();
      const { executionId } = await wf1.start({});

      await waitFor(async () => {
        const execution = await wf1.get(executionId);
        return execution.steps.some((s) => s.name === "first");
      });

      await stop(wf1);
      redis.expireLeaseNow(`workflow-v2:${name}:lease:${executionId}`);

      release = true;
      const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(execution.result).toBe("done");
    expect(completes).toBe(1);

      await stop(wf2);
    });
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { mightThrow } from "../errors/index.js";
import { WorkflowEngine } from "./engine.js";
import {
  DuplicateWorkflowError,
  defineWorkflow,
  listWorkflows,
  NonRetryableStepError,
  NotFoundError,
  SerializationError,
  type Workflow,
  WorkflowStoreError,
} from "./index.js";
import { createRedis, type MockRedisClient } from "./redis.mock.js";
import { WorkflowStore } from "./store.js";

const drainMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

let advancing = false;

const advanceTimersByTimeAsync = async (ms: number) => {
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
        await drainMicrotasks();
        break;
      }

      const step = Math.min(5, end - Date.now());
      jest.advanceTimersByTime(step);
      await drainMicrotasks();
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

const failOnce = (name: string, redis: Bun.RedisClient) => {
  let attempts = 0;

  return defineWorkflow({
    name,
    redis,
    ...fast,
    retries: 0,
    retentionTTL: 60_000,
    handler: async ({ step }) => {
      const value = await step("once", async () => {
        attempts++;

        if (attempts === 1) throw new Error("boom");

        return "ok";
      });

      return value;
    },
  });
};

describe("workflow", () => {
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
    expect(Number.isFinite(execution.completedAt)).toBe(true);

    for (const step of execution.steps) {
      expect(Number.isFinite(step.completedAt)).toBe(true);
    }

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

    await waitFor(async () => {
      const execution = await wf1.get(executionId);
      return execution.steps.some((step) => step.name === "first");
    });

    expect(counts.first).toBe(1);

    expireLeases(redis);

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(counts.first).toBe(1);
    expect(counts.second).toBe(1);

    await stop(wf2);
  });

  test("crash mid-step re-executes then continues", async () => {
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
          await durableSleep(200);
          await step("finish", async () => "done");
          return "ok";
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await sleep(25);

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed", 5000);

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

  test("retry backoff honors delay with short lockTTL", async () => {
    const redis = createRedis();
    let attempts = 0;

    const wf = defineWorkflow({
      name: `retry-delay-${crypto.randomUUID()}`,
      redis,
      ...fast,
      lockTTL: 40,
      retries: 2,
      retryBackoff: { baseDelay: 500, multiplier: 1, maxDelay: 500 },
      handler: async ({ step }) => {
        await step("flaky", async () => {
          attempts++;
          throw new Error("boom");
        });
      },
    });

    const { executionId } = await wf.start({});

    await sleep(200);
    expect(attempts).toBe(1);

    await waitStatus(wf, executionId, "failed", 5000);
    expect(attempts).toBe(3);

    await stop(wf);
  });

  test("reclaim restores step retry after timer drop", async () => {
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
    redis.clearZset(`workflow:${name}:timers`);

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

    await wf.start({ key: "shared" }, { executionId: "p-a" });
    await wf.start({ key: "shared" }, { executionId: "p-b" });

    await waitStatus(wf, "p-a", "completed");
    await waitStatus(wf, "p-b", "completed");

    expect(maxConcurrent).toBe(1);

    await stop(wf);
  });

  test("global concurrency caps different partition keys", async () => {
    const redis = createRedis();
    let concurrent = 0;
    let maxConcurrent = 0;

    const wf = defineWorkflow<{ key: string }, boolean>({
      name: `part-global-${crypto.randomUUID()}`,
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

    await wf.start({ key: "a" }, { executionId: "pg-a" });
    await wf.start({ key: "b" }, { executionId: "pg-b" });

    await waitStatus(wf, "pg-a", "completed");
    await waitStatus(wf, "pg-b", "completed");

    expect(maxConcurrent).toBe(1);

    await stop(wf);
  });

  test("global concurrency caps parallel instances", async () => {
    const redis = createRedis();
    let concurrent = 0;
    let maxConcurrent = 0;

    const wf = defineWorkflow({
      name: `global-conc-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
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

    await wf.start({}, { executionId: "g-a" });
    await wf.start({}, { executionId: "g-b" });

    await waitStatus(wf, "g-a", "completed");
    await waitStatus(wf, "g-b", "completed");

    expect(maxConcurrent).toBe(1);

    await stop(wf);
  });

  test("global concurrency held across durable sleep", async () => {
    const redis = createRedis();
    let concurrent = 0;
    let maxConcurrent = 0;

    const wf = defineWorkflow({
      name: `global-sleep-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      lockTTL: 40,
      handler: async ({ sleep: durableSleep, step }) => {
        await durableSleep(200);
        await step("work", async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(20);
          concurrent--;
          return "ok";
        });
        return "done";
      },
    });

    await wf.start({}, { executionId: "gs-1" });
    await wf.start({}, { executionId: "gs-2" });

    await waitStatus(wf, "gs-1", "completed", 5000);
    await waitStatus(wf, "gs-2", "completed", 5000);

    expect(maxConcurrent).toBe(1);

    await stop(wf);
  });

  test("global concurrency shared across replica engines", async () => {
    const redis = createRedis();
    const name = `global-replica-${crypto.randomUUID()}`;
    let concurrent = 0;
    let maxConcurrent = 0;

    const handler = async ({
      step,
    }: {
      step: <T>(n: string, h: () => T | Promise<T>) => Promise<T>;
    }) => {
      await step("work", async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(20);
        concurrent--;
        return true;
      });

      return true;
    };

    const store1 = new WorkflowStore(redis, name);
    const store2 = new WorkflowStore(redis, name);
    const engine1 = new WorkflowEngine(
      { name, redis, ...fast, concurrency: 1, handler },
      store1,
    );
    const engine2 = new WorkflowEngine(
      { name, redis, ...fast, concurrency: 1, handler },
      store2,
    );

    engine1.start();
    engine2.start();

    const start = async (executionId: string, store: WorkflowStore) => {
      await store.tryCreateMetaAndActive(executionId, {
        name,
        status: "pending",
        input: "{}",
        result: "",
        error: "",
        createdAt: String(Date.now()),
        updatedAt: String(Date.now()),
        completedAt: "",
        failedAt: "",
        cancelledAt: "",
        partitionKey: "*",
        partitionSlot: "",
        concurrencySlot: "",
      });
      await store.appendEvents({
        executionId,
        events: [
          {
            type: "WorkflowStarted",
            input: "{}",
            partitionKey: "*",
            timestamp: Date.now(),
          },
        ],
      });
      await store.enqueue(executionId);
    };

    await start("gr-a", store1);
    await start("gr-b", store2);

    await waitFor(async () => {
      const a = await store1.getMeta("gr-a");
      const b = await store2.getMeta("gr-b");
      return a?.status === "completed" && b?.status === "completed";
    });

    expect(maxConcurrent).toBe(1);

    await engine1.stop();
    await engine2.stop();
  });

  test("partition held across durable sleep", async () => {
    const redis = createRedis();
    let concurrent = 0;
    let maxConcurrent = 0;

    const wf = defineWorkflow<{ key: string }, string>({
      name: `part-sleep-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      lockTTL: 40,
      partitionBy: (input) => input.key,
      handler: async ({ sleep: durableSleep, step }) => {
        await durableSleep(200);
        await step("work", async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(20);
          concurrent--;
          return "ok";
        });
        return "done";
      },
    });

    await wf.start({ key: "shared" }, { executionId: "ps-1" });
    await wf.start({ key: "shared" }, { executionId: "ps-2" });

    await waitStatus(wf, "ps-1", "completed", 5000);
    await waitStatus(wf, "ps-2", "completed", 5000);

    expect(maxConcurrent).toBe(1);

    await stop(wf);
  });

  test("json roundtrip for input result and steps", async () => {
    const redis = createRedis();

    const wf = defineWorkflow<{ n: number }, { n: number }>({
      name: `json-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: async ({ input, step }) => {
        const doubled = await step("d", async () => input.n * 2);
        return { n: doubled as number };
      },
    });

    const { executionId } = await wf.start({ n: 4 });
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.input).toEqual({ n: 4 });
    expect(execution.result).toEqual({ n: 8 });

    await stop(wf);
  });

  test("void workflow result completes as null", async () => {
    const redis = createRedis();

    const wf = defineWorkflow<{ id: number }>({
      name: `void-result-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: async () => {},
    });

    const { executionId } = await wf.start({ id: 1 });
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBeNull();

    await stop(wf);
  });

  test("void step completes and does not re-run on resume", async () => {
    const redis = createRedis();
    let stepRuns = 0;
    let shouldFailWorkflow = true;

    const wf = defineWorkflow<{ id: number }, { ok: true }>({
      name: `void-step-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("side-effect", async () => {
          stepRuns++;
        });

        if (shouldFailWorkflow) {
          shouldFailWorkflow = false;
          throw new Error("fail after void step");
        }

        return { ok: true as const };
      },
    });

    const { executionId } = await wf.start({ id: 1 });
    await waitStatus(wf, executionId, "failed");

    expect(stepRuns).toBe(1);

    await wf.resume(executionId);
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toEqual({ ok: true });
    expect(execution.steps.map((s) => s.name)).toEqual(["side-effect"]);
    expect(stepRuns).toBe(1);

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
          await durableSleep(200);
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

    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed", 5000);

    expect(execution.result).toBe("slept");
    expect(finished).toBe(1);

    await stop(wf2);
  });

  test("durable sleep honors delay with short lockTTL", async () => {
    const redis = createRedis();
    let finished = false;

    const wf = defineWorkflow({
      name: `sleep-delay-${crypto.randomUUID()}`,
      redis,
      ...fast,
      lockTTL: 40,
      handler: async ({ sleep: durableSleep }) => {
        await durableSleep(500);
        finished = true;
        return "ok";
      },
    });

    const { executionId } = await wf.start({});

    await sleep(200);
    expect(finished).toBe(false);
    expect((await wf.get(executionId)).status).not.toBe("completed");

    const execution = await waitStatus(wf, executionId, "completed", 5000);
    expect(execution.result).toBe("ok");
    expect(finished).toBe(true);

    await stop(wf);
  });

  test("partition re-owned after lease loss during sleep", async () => {
    const redis = createRedis();
    let finished = false;

    const wf = defineWorkflow<{ key: string }, string>({
      name: `part-reown-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      lockTTL: 40,
      partitionBy: (input) => input.key,
      handler: async ({ sleep: durableSleep }) => {
        await durableSleep(200);
        finished = true;
        return "done";
      },
    });

    const { executionId } = await wf.start({ key: "shared" });

    await sleep(60);
    expireLeases(redis);

    const execution = await waitStatus(wf, executionId, "completed", 5000);

    expect(execution.result).toBe("done");
    expect(finished).toBe(true);

    await stop(wf);
  });

  test("partition slot survives holder stop during sleep until reclaim", async () => {
    const redis = createRedis();
    const name = `part-death-${crypto.randomUUID()}`;
    let concurrent = 0;
    let maxConcurrent = 0;
    const order: string[] = [];

    const make = () =>
      defineWorkflow<{ key: string }, string>({
        name,
        redis,
        ...fast,
        concurrency: 1,
        lockTTL: 10_000,
        partitionBy: (input) => input.key,
        handler: async ({ executionId, sleep: durableSleep, step }) => {
          await durableSleep(300);
          await step("work", async () => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            order.push(executionId);
            await sleep(20);
            concurrent--;
            return "ok";
          });
          return "done";
        },
      });

    const wf1 = make();
    await wf1.start({ key: "shared" }, { executionId: "holder" });

    await sleep(40);
    await stop(wf1);

    const wf2 = make();
    await wf2.start({ key: "shared" }, { executionId: "waiter" });

    await waitStatus(wf2, "holder", "completed", 5000);
    await waitStatus(wf2, "waiter", "completed", 5000);

    expect(maxConcurrent).toBe(1);
    expect(order).toEqual(["holder", "waiter"]);

    await stop(wf2);
  });

  test("timer claim crash restored from history", async () => {
    const redis = createRedis();
    const name = `timer-claim-${crypto.randomUUID()}`;
    let finished = 0;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL: 60,
        handler: async ({ sleep: durableSleep }) => {
          await durableSleep(100);
          finished++;
          return "ok";
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await sleep(30);
    redis.clearZset(`workflow:${name}:timers`);
    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed", 5000);

    expect(execution.result).toBe("ok");
    expect(finished).toBe(1);

    await stop(wf2);
  });

  test("corrupt timer payload is dead-lettered", async () => {
    const redis = createRedis();
    const name = `timer-dead-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      handler: async ({ step }) => {
        await step("go", async () => "ok");
        return "done";
      },
    });

    await redis.zadd(`workflow:${name}:timers`, Date.now() - 1, "not-json");

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("done");

    const dead = await redis.lrange(`workflow:${name}:timer-dead`, 0, -1);
    expect(dead).toContain("not-json");

    await stop(wf);
  });

  test("null timer payload is dead-lettered", async () => {
    const redis = createRedis();
    const name = `timer-null-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      handler: async ({ step }) => {
        await step("go", async () => "ok");
        return "done";
      },
    });

    await redis.zadd(`workflow:${name}:timers`, Date.now() - 1, "null");

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("done");

    const dead = await redis.lrange(`workflow:${name}:timer-dead`, 0, -1);
    expect(dead).toContain("null");

    await stop(wf);
  });

  test("cancel during durable sleep", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `cancel-sleep-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: async ({ sleep: durableSleep }) => {
        await durableSleep(500);
        return "ok";
      },
    });

    const { executionId } = await wf.start({});
    await sleep(30);

    const cancelResult = await wf.cancel(executionId);
    expect(cancelResult.cancelledAt).toBeNull();
    expect(cancelResult.status).not.toBe("cancelled");

    const execution = await waitStatus(wf, executionId, "cancelled");
    expect(execution.cancelledAt).not.toBeNull();

    await stop(wf);
  });

  test("cancel mid-step still records completed step then cancels", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `cancel-complete-step-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: async ({ executionId, step }) => {
        await step("finish-anyway", async () => {
          await wf.cancel(executionId);
          return "saved";
        });

        await step("after", async () => "should-not-run");

        return "done";
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(execution.status).toBe("cancelled");
    expect(execution.steps.map((s) => s.name)).toEqual(["finish-anyway"]);
    expect(execution.steps.some((s) => s.name === "after")).toBe(false);

    await stop(wf);
  });

  test("reclaim recovers start after markActive without history", async () => {
    const redis = createRedis();
    const name = `orphan-start-${crypto.randomUUID()}`;
    const executionId = crypto.randomUUID();
    const now = Date.now();

    await redis.hset(
      `workflow:${name}:meta:${executionId}`,
      "name",
      name,
      "status",
      "pending",
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
      "partitionKey",
      "",
      "partitionSlot",
      "",
      "concurrencySlot",
      "",
    );
    await redis.sadd(`workflow:${name}:active`, executionId);

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      handler: async ({ step }) => {
        await step("go", async () => "ok");
        return "done";
      },
    });

    const execution = await waitStatus(wf, executionId, "completed");
    expect(execution.result).toBe("done");

    await stop(wf);
  });

  test("reclaim re-enqueues scheduled step after queue drop", async () => {
    const redis = createRedis();
    const name = `sched-stuck-${crypto.randomUUID()}`;
    const executionId = crypto.randomUUID();
    const now = Date.now();
    let runs = 0;

    await redis.rpush(
      `workflow:${name}:history:${executionId}`,
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepScheduled",
        stepId: "a0",
        stepName: "only",
        attempt: 1,
        timestamp: now,
      }),
    );

    await redis.hset(
      `workflow:${name}:meta:${executionId}`,
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
      "partitionKey",
      "",
      "partitionSlot",
      "",
      "concurrencySlot",
      "",
    );

    await redis.sadd(`workflow:${name}:active`, executionId);

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

  test("reclaim drops immortal lease and continues", async () => {
    const redis = createRedis();
    const name = `immortal-lease-${crypto.randomUUID()}`;
    const executionId = crypto.randomUUID();
    const now = Date.now();
    let runs = 0;

    await redis.rpush(
      `workflow:${name}:history:${executionId}`,
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepScheduled",
        stepId: "a0",
        stepName: "only",
        attempt: 1,
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepStarted",
        stepId: "a0",
        attempt: 1,
        timestamp: now,
      }),
    );

    await redis.hset(
      `workflow:${name}:meta:${executionId}`,
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
      "partitionKey",
      "",
      "partitionSlot",
      "",
      "concurrencySlot",
      "",
    );

    await redis.sadd(`workflow:${name}:active`, executionId);
    await redis.set(`workflow:${name}:lease:${executionId}`, "zombie");

    expect(await redis.pttl(`workflow:${name}:lease:${executionId}`)).toBe(-1);

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      handler: async ({ step }) => {
        await step("only", async () => {
          runs++;
          return "ok";
        });

        return "done";
      },
    });

    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("done");
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

  test("resume under live workers leaves pending before enqueue", async () => {
    const redis = createRedis();
    let attempts = 0;

    const wf = defineWorkflow({
      name: `resume-live-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 2,
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

    // Workers already polling; status+active flip atomically before enqueue.
    const resumed = await wf.resume(executionId);

    expect(resumed.status).toBe("pending");
    expect((await wf.get(executionId)).status).not.toBe("failed");

    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(attempts).toBe(2);

    await stop(wf);
  });

  test("reclaim recovers resume after pending without StepScheduled", async () => {
    const redis = createRedis();
    const name = `resume-crash-${crypto.randomUUID()}`;
    const executionId = crypto.randomUUID();
    let attempts = 0;
    const now = Date.now();

    await redis.hset(
      `workflow:${name}:meta:${executionId}`,
      "name",
      name,
      "status",
      "pending",
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
      "partitionKey",
      "",
      "partitionSlot",
      "",
      "concurrencySlot",
      "",
    );

    await redis.rpush(
      `workflow:${name}:history:${executionId}`,
      JSON.stringify({
        type: "WorkflowStarted",
        input: "{}",
        partitionKey: "",
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepScheduled",
        stepId: "a0",
        stepName: "once",
        attempt: 1,
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepStarted",
        stepId: "a0",
        attempt: 1,
        timestamp: now,
      }),
      JSON.stringify({
        type: "StepFailed",
        stepId: "a0",
        stepName: "once",
        error: "boom",
        retryable: true,
        attempt: 1,
        timestamp: now,
      }),
      JSON.stringify({
        type: "WorkflowFailed",
        error: "boom",
        timestamp: now,
      }),
      JSON.stringify({
        type: "WorkflowResumed",
        timestamp: now,
      }),
    );

    await redis.sadd(`workflow:${name}:active`, executionId);

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        const value = await step("once", async () => {
          attempts++;
          return "ok";
        });

        return value;
      },
    });

    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(attempts).toBe(1);

    await stop(wf);
  });

  test("step retry timer does not revive completed step", async () => {
    const redis = createRedis();
    const name = `retry-done-${crypto.randomUUID()}`;
    let attempts = 0;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 2,
      retryBackoff: { baseDelay: 10_000, multiplier: 1, maxDelay: 10_000 },
      handler: async ({ step }) => {
        await step("flaky", async () => {
          attempts++;

          if (attempts === 1) throw new Error("boom");

          return "ok";
        });

        return "done";
      },
    });

    const { executionId } = await wf.start({});
    await waitFor(() => attempts >= 1, 2000);
    await sleep(15);

    await redis.rpush(
      `workflow:${name}:history:${executionId}`,
      JSON.stringify({
        type: "StepCompleted",
        stepId: "a0",
        stepName: "flaky",
        result: JSON.stringify("ok"),
        timestamp: Date.now(),
      }),
    );

    await sleep(10_000);
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("done");
    expect(attempts).toBe(1);

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
      `workflow:${name}:history:${executionId}`,
      JSON.stringify({
        type: "WorkflowCancelRequested",
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

    test("rejects empty or colon-containing execution ids", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `bad-id-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await expect(wf.start({}, { executionId: "" })).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: "Execution id must be a non-empty string",
      });

      await expect(wf.start({}, { executionId: "a:b" })).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: 'Execution id must not contain ":"',
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

    test("resume rejects pending executions that never failed", async () => {
      const redis = createRedis();
      const name = `resume-pending-${crypto.randomUUID()}`;
      const executionId = crypto.randomUUID();
      const now = String(Date.now());

      await redis.hset(
        `workflow:${name}:meta:${executionId}`,
        "name",
        name,
        "status",
        "pending",
        "input",
        "{}",
        "result",
        "",
        "error",
        "",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        "",
        "cancelledAt",
        "",
        "partitionKey",
        "",
        "partitionSlot",
        "",
        "concurrencySlot",
        "",
      );
      await redis.rpush(
        `workflow:${name}:history:${executionId}`,
        JSON.stringify({
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: Number(now),
        }),
      );

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        handler: async () => "done",
      });

      await expect(wf.resume(executionId)).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: expect.stringContaining(
          "only failed executions can be resumed",
        ),
      });

      await stop(wf);
    });

    test("start returns pending immediately", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `start-pending-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "done",
      });

      const started = await wf.start({}, { executionId: "pending-1" });

      expect(started).toEqual({
        executionId: "pending-1",
        status: "pending",
      });

      await waitStatus(wf, "pending-1", "completed");
      await stop(wf);
    });

    test("retries 0 fails on first thrown error", async () => {
      const redis = createRedis();
      let attempts = 0;

      const wf = defineWorkflow({
        name: `retries-zero-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("once", async () => {
            attempts++;
            throw new Error("no retry");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(attempts).toBe(1);
      expect(execution.error).toBe("no retry");

      await stop(wf);
    });

    test("resume rejects cancelled executions", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `resume-cancelled-${crypto.randomUUID()}`,
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

    test("default retries is 3 meaning 4 total attempts", async () => {
      const redis = createRedis();
      let attempts = 0;

      const wf = defineWorkflow({
        name: `default-retries-${crypto.randomUUID()}`,
        redis,
        pollInterval: 5,
        lockTTL: 40,
        retryBackoff: { baseDelay: 5, multiplier: 2, maxDelay: 20 },
        handler: async ({ step }) => {
          await step("flaky", async () => {
            attempts++;
            throw new Error("always");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(attempts).toBe(4);
      expect(execution.error).toBe("always");

      await stop(wf);
    });

    test("retryBackoff maxDelay caps nextRetryDelayMs", async () => {
      const redis = createRedis();
      const delays: number[] = [];

      const wf = defineWorkflow({
        name: `max-delay-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 3,
        retryBackoff: { baseDelay: 100, multiplier: 10, maxDelay: 150 },
        hooks: {
          onRetry: (context) => {
            delays.push(context.nextRetryDelayMs);
          },
        },
        handler: async ({ step }) => {
          await step("flaky", async () => {
            throw new Error("boom");
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      expect(delays.length).toBe(3);
      expect(delays.every((delay) => delay <= 150)).toBe(true);
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(150);
      expect(delays[2]).toBe(150);

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

    test("onRetry and onError hook errors do not change failure outcome", async () => {
      const redis = createRedis();
      let attempts = 0;

      const wf = defineWorkflow({
        name: `hook-retry-error-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 1,
        hooks: {
          onRetry: () => {
            throw new Error("retry hook boom");
          },
          onError: () => {
            throw new Error("error hook boom");
          },
        },
        handler: async ({ step }) => {
          await step("flaky", async () => {
            attempts++;
            throw new Error("step boom");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("step boom");
      expect(attempts).toBe(2);

      await stop(wf);
    });

    test("onCancel hook errors do not change cancel outcome", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `hook-cancel-error-${crypto.randomUUID()}`,
        redis,
        ...fast,
        hooks: {
          onCancel: () => {
            throw new Error("cancel hook boom");
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

      const { executionId } = await wf.start({});
      await sleep(20);
      await wf.cancel(executionId);

      const execution = await waitStatus(wf, executionId, "cancelled");

      expect(execution.status).toBe("cancelled");

      await stop(wf);
    });

    test("thrown NonRetryableStepError is non-retryable", async () => {
      const redis = createRedis();
      let attempts = 0;
      let onRetryCalls = 0;
      let onErrorCalls = 0;

      const wf = defineWorkflow({
        name: `throw-nonretry-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 5,
        hooks: {
          onRetry: () => {
            onRetryCalls++;
          },
          onError: () => {
            onErrorCalls++;
          },
        },
        handler: async ({ step }) => {
          await step("hard", async () => {
            attempts++;
            throw new NonRetryableStepError("hard stop");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("hard stop");
      expect(attempts).toBe(1);
      expect(onRetryCalls).toBe(0);
      expect(onErrorCalls).toBe(1);

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

    test("reports default backoff delay in onRetry context", async () => {
      const redis = createRedis();
      const retryDelays: number[] = [];

      const wf = defineWorkflow({
        name: `default-backoff-${crypto.randomUUID()}`,
        redis,
        pollInterval: 5,
        lockTTL: 40,
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
        },
      });

      const { executionId } = await wf.start({});

      await waitFor(() => retryDelays.length > 0);
      await wf.cancel(executionId);
      await waitStatus(wf, executionId, "cancelled");

      expect(retryDelays[0]).toBe(1000);

      await stop(wf);
    });
  });

  describe("falsy step outputs", () => {
    const cases = [
      ["null", null],
      ["undefined", undefined],
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

        expect(execution.result).toStrictEqual(value ?? null);
        expect(stepRuns).toBe(1);

        await stop(wf);
      });
    }
  });

  describe("serialization", () => {
    test("returns serialization error for circular input", async () => {
      const redis = createRedis();

      const wf = defineWorkflow<{ self?: unknown }, string>({
        name: `ser-input-err-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      const input: { self?: unknown } = {};
      input.self = input;

      await expect(wf.start(input)).rejects.toMatchObject({
        name: "SerializationError",
        message: "Unable to serialize input",
      });

      await stop(wf);
    });

    test("returns serialization error when result json is corrupt", async () => {
      const redis = createRedis();
      const name = `deser-result-err-${crypto.randomUUID()}`;

      const wf = defineWorkflow<{ id: number }, string>({
        name,
        redis,
        ...fast,
        handler: async () => "done",
      });

      const { executionId } = await wf.start({ id: 1 });
      await waitStatus(wf, executionId, "completed");

      await redis.hset(
        `workflow:${name}:meta:${executionId}`,
        "result",
        "not-json{{{",
      );

      await expect(wf.get(executionId)).rejects.toBeInstanceOf(
        SerializationError,
      );

      await stop(wf);
    });

    test("fails when step returns circular value", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `ser-step-err-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("circular", async () => {
            const value: { self?: unknown } = {};
            value.self = value;
            return value;
          });

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.status).toBe("failed");
      expect(execution.error).toMatch(/serializ/i);

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

  describe("determinism", () => {
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
      expect(execution.error).toContain("historical step");

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
      redis.expireLeaseNow(`workflow:${name}:lease:${executionId}`);

      release = true;
      const wf2 = make();
      const execution = await waitStatus(wf2, executionId, "completed");

      expect(execution.result).toBe("done");
      expect(completes).toBe(1);

      await stop(wf2);
    });
  });

  describe("listWorkflows", () => {
    test("returns empty list when no executions exist", async () => {
      const redis = createRedis();

      expect(await listWorkflows(redis)).toEqual([]);
    });

    test("lists executions across workflow names without defineWorkflow", async () => {
      const redis = createRedis();
      const now = String(Date.now());

      await redis.hset(
        "workflow:list-onboard:meta:onboard-1",
        "name",
        "list-onboard",
        "status",
        "completed",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        now,
        "failedAt",
        "",
        "cancelledAt",
        "",
      );

      await redis.hset(
        "workflow:list-provision:meta:provision-1",
        "name",
        "list-provision",
        "status",
        "failed",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        now,
        "cancelledAt",
        "",
      );

      const listed = await listWorkflows(redis);
      const names = listed.map((item) => item.name).sort();
      const ids = listed.map((item) => item.id).sort();

      expect(listed.length).toBe(2);
      expect(names).toEqual(["list-onboard", "list-provision"]);
      expect(ids).toEqual(["onboard-1", "provision-1"]);
    });

    test("filters by name and status", async () => {
      const redis = createRedis();
      const now = String(Date.now());

      await redis.hset(
        "workflow:filter-onboard:meta:filter-onboard-1",
        "name",
        "filter-onboard",
        "status",
        "completed",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        now,
        "failedAt",
        "",
        "cancelledAt",
        "",
      );

      await redis.hset(
        "workflow:filter-provision:meta:filter-provision-1",
        "name",
        "filter-provision",
        "status",
        "failed",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        now,
        "cancelledAt",
        "",
      );

      const byName = await listWorkflows(redis, { name: "filter-onboard" });
      const byStatus = await listWorkflows(redis, { status: "failed" });

      expect(byName.map((item) => item.id)).toEqual(["filter-onboard-1"]);
      expect(byStatus.map((item) => item.id)).toEqual(["filter-provision-1"]);
    });

    test("filters by name and status arrays", async () => {
      const redis = createRedis();
      const now = String(Date.now());

      await redis.hset(
        "workflow:arr-a:meta:arr-a-1",
        "name",
        "arr-a",
        "status",
        "pending",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        "",
        "cancelledAt",
        "",
      );

      await redis.hset(
        "workflow:arr-b:meta:arr-b-1",
        "name",
        "arr-b",
        "status",
        "running",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        "",
        "cancelledAt",
        "",
      );

      await redis.hset(
        "workflow:arr-c:meta:arr-c-1",
        "name",
        "arr-c",
        "status",
        "failed",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        now,
        "cancelledAt",
        "",
      );

      const byStatus = await listWorkflows(redis, {
        status: ["pending", "running"],
      });
      const byName = await listWorkflows(redis, { name: ["arr-a", "arr-c"] });

      expect(byStatus.map((item) => item.id).sort()).toEqual([
        "arr-a-1",
        "arr-b-1",
      ]);
      expect(byName.map((item) => item.id).sort()).toEqual([
        "arr-a-1",
        "arr-c-1",
      ]);
    });

    test("skips incomplete meta rows", async () => {
      const redis = createRedis();
      const now = String(Date.now());

      await redis.hset(
        "workflow:skip-ok:meta:skip-ok-1",
        "name",
        "skip-ok",
        "status",
        "completed",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        now,
        "failedAt",
        "",
        "cancelledAt",
        "",
      );

      await redis.hset(
        "workflow:skip-noname:meta:skip-noname-1",
        "status",
        "completed",
        "createdAt",
        now,
        "updatedAt",
        now,
      );

      await redis.hset(
        "workflow:skip-nostatus:meta:skip-nostatus-1",
        "name",
        "skip-nostatus",
        "createdAt",
        now,
        "updatedAt",
        now,
      );

      await redis.hset(
        "workflow:skip-nots:meta:skip-nots-1",
        "name",
        "skip-nots",
        "status",
        "completed",
      );

      const listed = await listWorkflows(redis);

      expect(listed.map((item) => item.id)).toEqual(["skip-ok-1"]);
    });

    test("listWorkflows keeps id when workflow name contains :meta:", async () => {
      const redis = createRedis();
      const now = String(Date.now());
      const name = "has:meta:in-name";

      await redis.hset(
        `workflow:${name}:meta:exec-1`,
        "name",
        name,
        "status",
        "running",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        "",
        "cancelledAt",
        "",
      );

      const listed = await listWorkflows(redis, { name });

      expect(listed.map((item) => item.id)).toEqual(["exec-1"]);
    });

    test("lists live executions started via defineWorkflow", async () => {
      const redis = createRedis();
      const name = `list-live-${crypto.randomUUID()}`;

      const wf = defineWorkflow<Record<string, never>, string>({
        name,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await wf.start({}, { executionId: "live-1" });
      await waitStatus(wf, "live-1", "completed");

      const listed = await listWorkflows(redis, { name });

      expect(listed).toEqual([
        expect.objectContaining({
          id: "live-1",
          name,
          status: "completed",
        }),
      ]);

      await stop(wf);
    });
  });

  describe("retention", () => {
    test("rejects invalid retention options", () => {
      expect(() =>
        defineWorkflow({
          name: `retain-bad-ttl-${crypto.randomUUID()}`,
          redis: createRedis(),
          retentionTTL: -1,
          handler: async () => "ok",
        }),
      ).toThrow("retentionTTL must be a non-negative number");

      expect(() =>
        defineWorkflow({
          name: `retain-bad-max-${crypto.randomUUID()}`,
          redis: createRedis(),
          retentionMax: 0,
          handler: async () => "ok",
        }),
      ).toThrow("retentionMax must be a positive integer");

      expect(() =>
        defineWorkflow({
          name: `retain-frac-max-${crypto.randomUUID()}`,
          redis: createRedis(),
          retentionMax: 1.5,
          handler: async () => "ok",
        }),
      ).toThrow("retentionMax must be a positive integer");
    });

    test("omitted retentionTTL expires terminal keys after 24h", async () => {
      const redis = createRedis();
      const name = `retain-default-${crypto.randomUUID()}`;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("ok");
      expect(
        await redis.pttl(`workflow:${name}:meta:${executionId}`),
      ).toBeGreaterThan(86_400_000 - 5_000);
      expect(
        await redis.pttl(`workflow:${name}:history:${executionId}`),
      ).toBeGreaterThan(86_400_000 - 5_000);

      await stop(wf);
    });

    test("retentionTTL Infinity leaves terminal keys persistent", async () => {
      const redis = createRedis();
      const name = `retain-inf-${crypto.randomUUID()}`;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retentionTTL: Infinity,
        handler: async () => "ok",
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "completed");

      expect(await redis.pttl(`workflow:${name}:meta:${executionId}`)).toBe(-1);
      expect(await redis.pttl(`workflow:${name}:history:${executionId}`)).toBe(
        -1,
      );

      await stop(wf);
    });

    test("terminal keys get TTL and running keys do not", async () => {
      const redis = createRedis();
      const name = `retain-ttl-${crypto.randomUUID()}`;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retentionTTL: 60_000,
        handler: async ({ sleep }) => {
          await sleep(200);
          return "ok";
        },
      });

      const { executionId } = await wf.start({});

      await waitStatus(wf, executionId, "running");

      expect(await redis.pttl(`workflow:${name}:meta:${executionId}`)).toBe(-1);
      expect(await redis.pttl(`workflow:${name}:history:${executionId}`)).toBe(
        -1,
      );

      const execution = await waitStatus(wf, executionId, "completed", 5000);

      expect(execution.result).toBe("ok");
      expect(
        await redis.pttl(`workflow:${name}:meta:${executionId}`),
      ).toBeGreaterThan(0);
      expect(
        await redis.pttl(`workflow:${name}:history:${executionId}`),
      ).toBeGreaterThan(0);

      await stop(wf);
    });

    test("retentionTTL 0 unlinks terminal keys", async () => {
      const redis = createRedis();
      const name = `retain-0-${crypto.randomUUID()}`;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retentionTTL: 0,
        handler: async () => "ok",
      });

      const { executionId } = await wf.start({});

      await waitFor(async () => {
        const [error] = await mightThrow(wf.get(executionId));

        return error instanceof NotFoundError;
      });

      expect(await redis.pttl(`workflow:${name}:meta:${executionId}`)).toBe(-2);
      expect(await redis.pttl(`workflow:${name}:history:${executionId}`)).toBe(
        -2,
      );
      expect(await redis.pttl(`workflow:${name}:lease:${executionId}`)).toBe(
        -2,
      );

      await stop(wf);
    });

    test("listWorkflows ignores expired SCAN tombstones", async () => {
      const redis = createRedis();
      const now = String(Date.now());

      await redis.hset(
        "workflow:tomb:meta:dead-1",
        "name",
        "tomb",
        "status",
        "completed",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        now,
        "failedAt",
        "",
        "cancelledAt",
        "",
      );
      await redis.hset(
        "workflow:tomb:meta:live-1",
        "name",
        "tomb",
        "status",
        "running",
        "createdAt",
        now,
        "updatedAt",
        now,
        "completedAt",
        "",
        "failedAt",
        "",
        "cancelledAt",
        "",
      );

      await redis.pexpire("workflow:tomb:meta:dead-1", 1);
      await sleep(5);

      const listed = await listWorkflows(redis, { name: "tomb" });

      expect(listed.map((item) => item.id)).toEqual(["live-1"]);
    });

    test("resume persists failed keys then completes", async () => {
      const redis = createRedis();
      const name = `retain-resume-${crypto.randomUUID()}`;
      const wf = failOnce(name, redis);
      const { executionId } = await wf.start({});

      await waitStatus(wf, executionId, "failed");

      expect(
        await redis.pttl(`workflow:${name}:meta:${executionId}`),
      ).toBeGreaterThan(0);

      await wf.resume(executionId);

      expect(await redis.pttl(`workflow:${name}:meta:${executionId}`)).toBe(-1);
      expect(await redis.pttl(`workflow:${name}:history:${executionId}`)).toBe(
        -1,
      );

      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("ok");
      expect(
        await redis.pttl(`workflow:${name}:meta:${executionId}`),
      ).toBeGreaterThan(0);

      await stop(wf);
    });

    test("resume after a later failure appends a new resume event", async () => {
      const redis = createRedis();
      const name = `retain-resume-again-${crypto.randomUUID()}`;
      let attempts = 0;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        retentionTTL: 60_000,
        handler: async ({ step }) => {
          const value = await step("once", async () => {
            attempts++;

            if (attempts < 3) throw new Error("boom");

            return "ok";
          });

          return value;
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await wf.resume(executionId);
      await waitStatus(wf, executionId, "failed");

      const store = new WorkflowStore(redis, name);

      expect(await store.persistExecution(executionId)).toBe(true);
      expect((await wf.get(executionId)).status).toBe("pending");

      await wf.resume(executionId);

      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("ok");
      expect(attempts).toBe(3);

      await stop(wf);
    });

    test("persist does not mark active so reclaim cannot re-fail mid-resume", async () => {
      const redis = createRedis();
      const name = `retain-reclaim-${crypto.randomUUID()}`;
      const wf = failOnce(name, redis);
      const { executionId } = await wf.start({});

      await waitStatus(wf, executionId, "failed");

      const store = new WorkflowStore(redis, name);

      expect(await store.persistExecution(executionId)).toBe(true);
      expect(await store.listActive()).not.toContain(executionId);

      await sleep(300);

      expect((await wf.get(executionId)).status).toBe("pending");

      await wf.resume(executionId);

      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("ok");

      await stop(wf);
    });

    test("resume retries after events without markActive", async () => {
      const redis = createRedis();
      const name = `retain-retry-events-${crypto.randomUUID()}`;
      const wf = failOnce(name, redis);
      const { executionId } = await wf.start({});

      await waitStatus(wf, executionId, "failed");

      const store = new WorkflowStore(redis, name);

      await store.persistExecution(executionId);
      await store.appendEvents({
        executionId,
        events: [
          {
            type: "WorkflowResumed",
            timestamp: Date.now(),
          },
          {
            type: "StepScheduled",
            stepId: "a0",
            stepName: "once",
            attempt: 1,
            timestamp: Date.now(),
          },
        ],
      });

      expect(await store.listActive()).not.toContain(executionId);

      await wf.resume(executionId);

      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("ok");

      await stop(wf);
    });

    test("resume racing retention sweep does not drop persisted keys", async () => {
      const redis = createRedis();
      const name = `retain-race-${crypto.randomUUID()}`;
      const wf = failOnce(name, redis);
      const { executionId } = await wf.start({});

      await waitStatus(wf, executionId, "failed");

      const store = new WorkflowStore(redis, name);
      const [resumed] = await Promise.allSettled([
        wf.resume(executionId),
        store.retainIfTerminal({
          executionId,
          ttlMs: 0,
        }),
      ]);

      if (resumed.status === "fulfilled") {
        const execution = await wf.get(executionId);

        expect(execution.status).not.toBe("failed");
      }

      if (resumed.status === "rejected") {
        await expect(wf.get(executionId)).rejects.toBeInstanceOf(NotFoundError);
      }

      await stop(wf);
    });

    test("retentionMax unlinks oldest terminal executions", async () => {
      const redis = createRedis();
      const name = `retain-max-${crypto.randomUUID()}`;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retentionTTL: 60_000,
        retentionMax: 2,
        handler: async () => "ok",
      });

      await wf.start({}, { executionId: "t1" });
      await waitStatus(wf, "t1", "completed");
      await sleep(5);
      await wf.start({}, { executionId: "t2" });
      await waitStatus(wf, "t2", "completed");
      await sleep(5);
      await wf.start({}, { executionId: "t3" });
      await waitStatus(wf, "t3", "completed");

      expect(await redis.pttl(`workflow:${name}:meta:t1`)).toBe(-2);
      expect(await redis.pttl(`workflow:${name}:meta:t2`)).toBeGreaterThan(0);
      expect(await redis.pttl(`workflow:${name}:meta:t3`)).toBeGreaterThan(0);

      await stop(wf);
    });

    test("retentionMax with Infinity TTL unlinks oldest and keeps the rest persistent", async () => {
      const redis = createRedis();
      const name = `retain-max-inf-${crypto.randomUUID()}`;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retentionTTL: Infinity,
        retentionMax: 2,
        handler: async () => "ok",
      });

      await wf.start({}, { executionId: "t1" });
      await waitStatus(wf, "t1", "completed");
      await sleep(5);
      await wf.start({}, { executionId: "t2" });
      await waitStatus(wf, "t2", "completed");
      await sleep(5);
      await wf.start({}, { executionId: "t3" });
      await waitStatus(wf, "t3", "completed");

      expect(await redis.pttl(`workflow:${name}:meta:t1`)).toBe(-2);
      expect(await redis.pttl(`workflow:${name}:meta:t2`)).toBe(-1);
      expect(await redis.pttl(`workflow:${name}:meta:t3`)).toBe(-1);

      await stop(wf);
    });

    test("sweep unlinks leftover terminal keys older than retentionTTL", async () => {
      const redis = createRedis();
      const name = `retain-sweep-${crypto.randomUUID()}`;
      const executionId = "stale-1";
      const ended = Date.now() - 48 * 60 * 60 * 1000;

      await redis.hset(
        `workflow:${name}:meta:${executionId}`,
        "name",
        name,
        "status",
        "completed",
        "input",
        "{}",
        "result",
        '"ok"',
        "error",
        "",
        "createdAt",
        String(ended),
        "updatedAt",
        String(ended),
        "completedAt",
        String(ended),
        "failedAt",
        "",
        "cancelledAt",
        "",
        "partitionKey",
        "",
        "partitionSlot",
        "",
        "concurrencySlot",
        "",
      );
      await redis.rpush(
        `workflow:${name}:history:${executionId}`,
        JSON.stringify({
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: ended,
        }),
      );

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retentionTTL: 1000,
        handler: async () => "ok",
      });

      await waitFor(async () => {
        return (
          (await redis.pttl(`workflow:${name}:meta:${executionId}`)) === -2
        );
      });

      expect(await redis.pttl(`workflow:${name}:history:${executionId}`)).toBe(
        -2,
      );

      await stop(wf);
    });
  });
});

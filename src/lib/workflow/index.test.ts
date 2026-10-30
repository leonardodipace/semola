import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mightThrow } from "../errors/index.js";
import { WorkflowEngine } from "./engine.js";
import {
  DuplicateWorkflowError,
  defineWorkflow,
  listWorkflows,
  NonRetryableStepError,
  NotFoundError,
  SerializationError,
  UnregisteredWorkflowError,
  type Workflow,
  type WorkflowHandlerContext,
  type WorkflowOptions,
  WorkflowStoreError,
} from "./index.js";
import {
  beforeCommit,
  beforeReleaseLease,
  closeRedis,
  createRedis,
  eventTypes,
  expireLeases,
  failNext,
  resetRedis,
  SEMOLA_REDIS_URL,
} from "./integration-helpers.js";
import {
  CANCEL_EXECUTION,
  RESUME_EXECUTION,
  TRIM_IF_MEMBER,
  WorkflowStore,
} from "./store.js";

const sleep = (ms: number) => Bun.sleep(ms);

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
) => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;

    await sleep(5);
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

const awaitStartSync = async <T>(promise: Promise<T>, timeoutMs = 3000) => {
  const start = Date.now();
  let settled: T | undefined;
  let done = false;

  void promise.then((value) => {
    settled = value;
    done = true;
  });

  while (Date.now() - start < timeoutMs) {
    if (done) return settled as T;

    await sleep(5);
  }

  throw new Error("awaitStartSync timeout");
};

const fast = {
  pollInterval: 10,
  lockTTL: 200,
  retryBackoff: { baseDelay: 10, multiplier: 2, maxDelay: 40 },
};

// Another process polling the same workflow. One process never runs more
// than `concurrency` handlers, so only replicas can break a shared cap.
const replica = <TInput, TResult>(
  options: WorkflowOptions<TInput, TResult>,
) => {
  const engine = new WorkflowEngine(
    options,
    new WorkflowStore(options.redis, options.name),
  );

  engine.start();
  return engine;
};

// One step that runs until the test releases it, so a test cancels it
// mid-step once `entered` is set instead of racing a timer.
const blockingStep = () => {
  const state = { entered: false, released: false };

  const handler = async ({ step }: WorkflowHandlerContext<unknown>) => {
    await step("long", async () => {
      state.entered = true;

      while (!state.released) {
        await sleep(5);
      }
    });
  };

  return { state, handler };
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

describe.skipIf(!SEMOLA_REDIS_URL)("workflow", () => {
  beforeEach(resetRedis);
  afterEach(closeRedis);

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

    await wf.stop();
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

    await expireLeases(redis);

    await wf1.stop();

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(counts.first).toBe(1);
    expect(counts.second).toBe(1);

    await wf2.stop();
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

    await expireLeases(redis);

    await wf1.stop();

    const wf2 = make();
    await waitStatus(wf2, executionId, "completed");
    const started = (
      await new WorkflowStore(redis, name).loadHistory(executionId)
    )
      .map((raw) => JSON.parse(raw) as { type: string; attempt?: number })
      .filter((event) => event.type === "StepStarted")
      .map((event) => event.attempt);

    expect(attempts).toBeGreaterThanOrEqual(2);
    // The interrupted attempt runs again under the same number.
    expect(started.length).toBe(attempts);
    expect(started.every((attempt) => attempt === 1)).toBe(true);

    await wf2.stop();
  });

  test("lease lost mid-step and reclaimed by the same process still records failures and honors retries", async () => {
    const redis = createRedis();
    const name = `lost-lease-${crypto.randomUUID()}`;
    const abortedAtStart: boolean[] = [];

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 2,
      handler: async ({ step }) => {
        await step("fragile", async ({ signal }) => {
          abortedAtStart.push(signal.aborted);

          // The first call hangs until the heartbeat notices the lost lease.
          if (abortedAtStart.length === 1) {
            while (!signal.aborted) {
              await sleep(10);
            }
          }

          throw new Error(`boom ${abortedAtStart.length}`);
        });
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(() => abortedAtStart.length === 1);
    await expireLeases(redis);

    const execution = await waitStatus(wf, executionId, "failed");
    const failed = (
      await new WorkflowStore(redis, name).loadHistory(executionId)
    )
      .map((raw) => JSON.parse(raw) as { type: string; attempt?: number })
      .filter((event) => event.type === "StepFailed")
      .map((event) => event.attempt);

    // The run that lost the lease records nothing; the reclaimed runs record
    // retries + 1 attempts, none starting with an aborted signal.
    expect(failed).toEqual([1, 2, 3]);
    expect(abortedAtStart).toEqual([false, false, false, false]);
    expect(execution.error).toBe("boom 4");

    await sleep(250);
    expect(abortedAtStart).toHaveLength(4);

    await wf.stop();
  });

  test("multi-worker concurrency drains without double-complete", async () => {
    const redis = createRedis();
    let runs = 0;
    let completes = 0;

    const wf = defineWorkflow({
      name: `multi-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 3,
      hooks: {
        onComplete: () => {
          completes++;
        },
      },
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
      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe(1);
    }

    expect(runs).toBe(4);
    expect(completes).toBe(4);

    await wf.stop();
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

    await wf.stop();
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
      retryBackoff: { baseDelay: 200, multiplier: 1, maxDelay: 200 },
      handler: async ({ step }) => {
        await step("flaky", async () => {
          attempts++;
          throw new Error("boom");
        });
      },
    });

    const { executionId } = await wf.start({});

    await sleep(100);
    expect(attempts).toBe(1);

    await waitStatus(wf, executionId, "failed", 5000);
    expect(attempts).toBe(3);

    await wf.stop();
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
          fail(new Error("hard stop"));
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("hard stop");
    expect(attempts).toBe(1);

    await wf.stop();
  });

  test("synchronous throws from steps and compensations are step failures", async () => {
    const redis = createRedis();
    let attempts = 0;
    let undone = 0;

    const wf = defineWorkflow({
      name: `sync-throw-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 1,
      handler: async ({ step }) => {
        await step("flaky", () => {
          attempts++;
          if (attempts === 1) throw new Error("sync boom");
          return "ok";
        });
        await step("undoable", () => "made", {
          compensate: ({ fail }) => {
            undone++;
            fail(new Error("undo refused"));
          },
        });
        await step("stop", ({ fail }) => fail(new Error("hard stop")));
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(attempts).toBe(2);
    expect(undone).toBe(1);
    expect(execution.error).toBe("undo refused");

    await wf.stop();
  });

  test("synchronous throw from the workflow handler fails the run", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `sync-handler-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: () => {
        throw new Error("sync handler boom");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("sync handler boom");

    await wf.stop();
  });

  test("cancel during run", async () => {
    const redis = createRedis();
    const { state, handler } = blockingStep();

    const wf = defineWorkflow({
      name: `cancel-run-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler,
    });

    const { executionId } = await wf.start({});
    await waitFor(() => state.entered);
    const cancelResult = await wf.cancel(executionId);
    state.released = true;

    expect(cancelResult.status).toBe("running");
    expect(cancelResult.cancelledAt).toBeNull();

    const execution = await waitStatus(wf, executionId, "cancelled");

    // The in-flight step finishes and is recorded; cancel is honored at
    // that write.
    expect(execution.error).toBeNull();
    expect(await eventTypes(redis, wf.name, executionId)).toContain(
      "StepCompleted",
    );

    await wf.stop();
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

    await waitStatus(wf, executionId, "cancelled");

    await wf.stop();
  });

  test("partitionBy caps executions sharing a key across replicas", async () => {
    const redis = createRedis();
    let concurrent = 0;
    let maxConcurrent = 0;

    const options: WorkflowOptions<{ key: string }, void> = {
      name: `part-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      partitionBy: (input) => input.key,
      handler: async ({ step }) => {
        await step("work", async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(50);
          concurrent--;
        });
      },
    };
    const wf = defineWorkflow(options);
    const other = replica(options);

    await wf.start({ key: "shared" }, { executionId: "p-a" });
    await wf.start({ key: "shared" }, { executionId: "p-b" });

    await waitStatus(wf, "p-a", "completed");
    await waitStatus(wf, "p-b", "completed");

    expect(maxConcurrent).toBe(1);

    await other.stop();
    await wf.stop();
  });

  test("partitionBy concurrency is per key not global", async () => {
    const redis = createRedis();
    const name = `part-global-${crypto.randomUUID()}`;
    let concurrent = 0;
    let maxConcurrent = 0;

    // One process runs at most `concurrency` handlers, so two replicas show
    // that different keys do not share the cap.
    const options = {
      name,
      redis,
      ...fast,
      concurrency: 1,
      partitionBy: (input: { key: string }) => input.key,
      handler: async ({ step }: WorkflowHandlerContext<{ key: string }>) => {
        await step("work", async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(20);
          concurrent--;
        });
      },
    };
    const store = new WorkflowStore(redis, name);
    const engines = [
      new WorkflowEngine(options, store),
      new WorkflowEngine(options, new WorkflowStore(redis, name)),
    ];

    for (const key of ["a", "b"]) {
      const now = String(Date.now());

      await store.createExecution(`pg-${key}`, {
        name,
        status: "pending",
        input: JSON.stringify({ key }),
        result: "",
        error: "",
        createdAt: now,
        updatedAt: now,
        completedAt: "",
        failedAt: "",
        cancelledAt: "",
        partitionKey: key,
        cancelRequestedAt: "",
      });
    }

    for (const engine of engines) engine.start();

    await waitFor(async () => {
      const a = await store.getMeta("pg-a");
      const b = await store.getMeta("pg-b");
      return a?.status === "completed" && b?.status === "completed";
    });

    expect(maxConcurrent).toBe(2);

    for (const engine of engines) await engine.stop();
  });

  test("global concurrency caps executions across replicas", async () => {
    const redis = createRedis();
    let concurrent = 0;
    let maxConcurrent = 0;

    const options: WorkflowOptions<unknown, void> = {
      name: `global-conc-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      handler: async ({ step }) => {
        await step("work", async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(50);
          concurrent--;
        });
      },
    };
    const wf = defineWorkflow(options);
    const other = replica(options);

    await wf.start({}, { executionId: "g-a" });
    await wf.start({}, { executionId: "g-b" });

    await waitStatus(wf, "g-a", "completed");
    await waitStatus(wf, "g-b", "completed");

    expect(maxConcurrent).toBe(1);

    await other.stop();
    await wf.stop();
  });

  // The poller is free while an execution sleeps, so one process is enough
  // to see a second execution get in if the slot were let go.
  test("global concurrency slot is held across durable sleep", async () => {
    const redis = createRedis();
    let active = 0;
    let maxActive = 0;

    const wf = defineWorkflow({
      name: `global-sleep-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      lockTTL: 40,
      handler: async ({ sleep: durableSleep, step }) => {
        await step("enter", async () => {
          active++;
          maxActive = Math.max(maxActive, active);
        });
        await durableSleep(200);
        await step("exit", async () => {
          active--;
        });
        return "done";
      },
    });

    await wf.start({}, { executionId: "gs-1" });
    await wf.start({}, { executionId: "gs-2" });

    await waitStatus(wf, "gs-1", "completed", 5000);
    await waitStatus(wf, "gs-2", "completed", 5000);

    expect(maxActive).toBe(1);

    await wf.stop();
  });

  test("partition slot is held across durable sleep", async () => {
    const redis = createRedis();
    let active = 0;
    let maxActive = 0;

    const wf = defineWorkflow<{ key: string }, string>({
      name: `part-sleep-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      lockTTL: 40,
      partitionBy: (input) => input.key,
      handler: async ({ sleep: durableSleep, step }) => {
        await step("enter", async () => {
          active++;
          maxActive = Math.max(maxActive, active);
        });
        await durableSleep(200);
        await step("exit", async () => {
          active--;
        });
        return "done";
      },
    });

    await wf.start({ key: "shared" }, { executionId: "ps-1" });
    await wf.start({ key: "shared" }, { executionId: "ps-2" });

    await waitStatus(wf, "ps-1", "completed", 5000);
    await waitStatus(wf, "ps-2", "completed", 5000);

    expect(maxActive).toBe(1);

    await wf.stop();
  });

  // The sleep's due time is committed, then the worker dies before
  // releaseLease, so nothing pushes the slot past the last heartbeat.
  test("a slot is held across durable sleep when the worker crashes before release", async () => {
    const redis = createRedis();
    const lockTTL = 40;
    const sleepMs = 300;
    const order: string[] = [];
    let crashed = false;

    beforeReleaseLease(({ executionId, dueAt }) => {
      if (crashed) return;
      if (executionId !== "crash-sleeper") return;
      if (dueAt <= Date.now() + lockTTL) return;

      crashed = true;
      throw new Error("crashed");
    });

    const wf = defineWorkflow({
      name: `crash-sleep-slot-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 1,
      lockTTL,
      handler: async ({ executionId, sleep: durableSleep, step }) => {
        await step("enter", async () => {
          order.push(`enter:${executionId}`);
        });
        await durableSleep(sleepMs);
        await step("exit", async () => {
          order.push(`exit:${executionId}`);
        });
      },
    });

    await wf.start({}, { executionId: "crash-sleeper" });
    await waitFor(() => crashed);
    await wf.start({}, { executionId: "next" });

    await waitStatus(wf, "crash-sleeper", "completed", 5000);
    await waitStatus(wf, "next", "completed", 5000);

    expect(order).toEqual([
      "enter:crash-sleeper",
      "exit:crash-sleeper",
      "enter:next",
      "exit:next",
    ]);

    await wf.stop();
  });

  test("heartbeats keep a step longer than lockTTL leased and in its slot", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const options: WorkflowOptions<unknown, void> = {
      name: `heartbeat-${crypto.randomUUID()}`,
      redis,
      ...fast,
      lockTTL: 150,
      concurrency: 1,
      handler: async ({ executionId, step }) => {
        await step("work", async () => {
          order.push(`start:${executionId}`);
          await sleep(500);
          order.push(`end:${executionId}`);
        });
      },
    };
    const wf = defineWorkflow(options);
    const other = replica(options);

    await wf.start({}, { executionId: "long" });
    await waitFor(() => order.includes("start:long"));
    await wf.start({}, { executionId: "next" });

    await waitStatus(wf, "long", "completed");
    await waitStatus(wf, "next", "completed");

    // A lapsed lease re-runs "long"; a lapsed slot lets "next" in early.
    expect(order).toEqual(["start:long", "end:long", "start:next", "end:next"]);

    await other.stop();
    await wf.stop();
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

    await wf.stop();
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

    await wf.stop();
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

    await wf.stop();
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

    await wf.stop();
  });

  test("durable sleep resumes on another replica without restarting the timer", async () => {
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
          await durableSleep(300);
          await step("after", async () => {
            finished++;
            return true;
          });
          return "slept";
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await waitFor(async () =>
      (await eventTypes(redis, name, executionId)).includes("TimerStarted"),
    );
    await wf1.stop();
    // Nobody runs it for a while: the timer must still fire at its fireAt.
    await sleep(300);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "completed", 5000);
    const types = await eventTypes(redis, name, executionId);

    expect(execution.result).toBe("slept");
    expect(finished).toBe(1);
    expect(types.filter((type) => type === "TimerStarted")).toHaveLength(1);
    // A timer restarted by wf2 would end 600ms+ after creation.
    expect((execution.completedAt ?? 0) - execution.createdAt).toBeLessThan(
      550,
    );

    await wf2.stop();
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

    await wf.stop();
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
    await expireLeases(redis);

    const execution = await waitStatus(wf, executionId, "completed", 5000);

    expect(execution.result).toBe("done");
    expect(finished).toBe(true);

    await wf.stop();
  });

  test("partition slot survives holder stop during sleep until it runs again", async () => {
    const redis = createRedis();
    const name = `part-death-${crypto.randomUUID()}`;
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
          await step("enter", async () => {
            order.push(`enter:${executionId}`);
          });
          await durableSleep(300);
          await step("exit", async () => {
            order.push(`exit:${executionId}`);
          });
          return "done";
        },
      });

    const wf1 = make();
    await wf1.start({ key: "shared" }, { executionId: "holder" });

    await waitFor(() => order.includes("enter:holder"));
    await wf1.stop();

    const wf2 = make();
    await wf2.start({ key: "shared" }, { executionId: "waiter" });

    await waitStatus(wf2, "holder", "completed", 5000);
    await waitStatus(wf2, "waiter", "completed", 5000);

    // The waiter only gets in once the holder has finished.
    expect(order).toEqual([
      "enter:holder",
      "exit:holder",
      "enter:waiter",
      "exit:waiter",
    ]);

    await wf2.stop();
  });

  test("a sleeping execution keeps its slot with no process alive until due + lockTTL", async () => {
    const redis = createRedis();
    const name = `slot-orphan-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      concurrency: 1,
      lockTTL: 300,
      handler: async ({ sleep: durableSleep }) => {
        await durableSleep(600);
      },
    });

    const { executionId } = await wf.start({});
    const startedAt = Date.now();

    await waitStatus(wf, executionId, "running");
    await sleep(50);
    await wf.stop();

    // Nobody refreshes the slot, yet the cap still holds until fireAt + lockTTL.
    expect(await store.acquireCapacity("*", "probe", 1, 1000)).toBe(false);

    await sleep(startedAt + 600 + 300 - 100 - Date.now());
    expect(await store.acquireCapacity("*", "probe", 1, 1000)).toBe(false);

    await sleep(200);
    expect(await store.acquireCapacity("*", "probe", 1, 1000)).toBe(true);
  });

  test("partitionBy with many keys never exceeds concurrency handlers in one process", async () => {
    const redis = createRedis();
    let inFlight = 0;
    let maxInFlight = 0;

    const wf = defineWorkflow<{ key: string }, void>({
      name: `bounded-${crypto.randomUUID()}`,
      redis,
      ...fast,
      concurrency: 2,
      partitionBy: (input) => input.key,
      handler: async ({ step }) => {
        await step("work", async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(20);
          inFlight--;
        });
      },
    });

    const ids: string[] = [];

    for (let i = 0; i < 8; i++) {
      ids.push((await wf.start({ key: `k${i}` })).executionId);
    }

    for (const id of ids) await waitStatus(wf, id, "completed");

    expect(maxInFlight).toBe(2);

    await wf.stop();
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

    await wf.stop();
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

    expect(execution.steps.map((s) => s.name)).toEqual(["finish-anyway"]);
    expect(execution.steps.some((s) => s.name === "after")).toBe(false);

    await wf.stop();
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

    await wf.stop();
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

    const resumed = await wf.resume(executionId);

    expect(resumed.status).toBe("pending");
    expect((await wf.get(executionId)).status).not.toBe("failed");

    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(attempts).toBe(2);

    await wf.stop();
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
      retryBackoff: { baseDelay: 300, multiplier: 1, maxDelay: 300 },
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

    await sleep(300);
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("done");
    expect(attempts).toBe(1);

    await wf.stop();
  });

  test("resume clears sticky cancel after fail race", async () => {
    const redis = createRedis();
    let attempts = 0;
    const name = `resume-cancel-${crypto.randomUUID()}`;
    const metaKey = (id: string) => `workflow:${name}:meta:${id}`;

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

    // A cancel accepted just before the run committed its failure.
    await redis.hset(metaKey(executionId), "cancelRequestedAt", "1");

    await wf.resume(executionId);

    expect((await redis.hgetall(metaKey(executionId))).cancelRequestedAt).toBe(
      "",
    );

    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");

    await wf.stop();
  });

  test("lease holder reads history once per lease, not after its own writes", async () => {
    const redis = createRedis();
    const name = `single-read-${crypto.randomUUID()}`;
    const historyKey = (id: string) => `workflow:${name}:history:${id}`;
    const store = new WorkflowStore(redis, name);
    let reads = 0;
    let target = "";

    const lrange = redis.lrange.bind(redis);
    redis.lrange = async (key: string, start: number, stop: number) => {
      if (key === historyKey(target)) reads++;

      return lrange(key, start, stop);
    };

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      lockTTL: 60_000,
      handler: async ({ step }) => {
        let total = 0;

        for (let i = 0; i < 5; i++) {
          total += await step(`s${i}`, async () => i);
        }

        return total;
      },
    });

    target = "five-steps";
    await wf.start({}, { executionId: target });

    // Poll meta only: get() reads history itself.
    await waitFor(
      async () => (await store.getMeta(target))?.status === "completed",
    );

    expect((await store.getMeta(target))?.result).toBe("10");
    // WorkflowStarted, StepStarted + StepCompleted per step, WorkflowCompleted.
    expect(await store.loadHistory(target)).toHaveLength(12);
    reads--; // the loadHistory call just above

    expect(reads).toBe(1);

    await wf.stop();
  });

  test("an internal error mid-run retries after a short delay, not lockTTL", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `run-error-${crypto.randomUUID()}`,
      redis,
      ...fast,
      lockTTL: 60_000,
      handler: async ({ step }) => {
        await step("work", () => "ok");
        return "done";
      },
    });

    // The first run's history read fails after the execution is claimed.
    // Let the engine hit it before get() (which also reads history) polls.
    failNext(redis, "lrange");

    const { executionId } = await wf.start({});
    await sleep(50);

    const execution = await waitStatus(wf, executionId, "completed", 1000);

    expect(execution.result).toBe("done");

    await wf.stop();
  });

  test("a crashed worker's execution runs again after lockTTL", async () => {
    const redis = createRedis();
    const name = `crash-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    const now = String(Date.now());
    let runs = 0;

    await store.createExecution("e1", {
      name,
      status: "pending",
      input: "{}",
      result: "",
      error: "",
      createdAt: now,
      updatedAt: now,
      completedAt: "",
      failedAt: "",
      cancelledAt: "",
      partitionKey: "",
      cancelRequestedAt: "",
    });
    // A worker claims it and dies without heartbeat or release.
    expect(await store.claimDue("dead-worker", 300)).toBe("e1");

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      lockTTL: 300,
      handler: async ({ step }) => {
        await step("work", async () => {
          runs++;
        });
        return "done";
      },
    });

    await sleep(150);
    expect(runs).toBe(0);

    const execution = await waitStatus(wf, "e1", "completed");

    expect(execution.result).toBe("done");
    expect(runs).toBe(1);

    await wf.stop();
  });

  test("cancel during a long sleep is honoured promptly", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `cancel-long-sleep-${crypto.randomUUID()}`,
      redis,
      ...fast,
      handler: async ({ sleep: durableSleep }) => {
        await durableSleep(60 * 60_000);
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "running");
    await sleep(50);
    await wf.cancel(executionId);

    const execution = await waitStatus(wf, executionId, "cancelled", 200);

    expect(execution.cancelledAt).not.toBeNull();

    await wf.stop();
  });

  test("idle sleeping executions cause no history reads", async () => {
    const redis = createRedis();
    const name = `idle-sleep-${crypto.randomUUID()}`;
    let reads = 0;

    // Sleepers keep their capacity slot, so the cap must fit all of them.
    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      concurrency: 50,
      handler: async ({ sleep: durableSleep }) => {
        await durableSleep(60_000);
      },
    });

    for (let i = 0; i < 50; i++) await wf.start({});

    // Wait until every execution is parked at its sleep's fireAt.
    await waitFor(async () => {
      const due = `workflow:${name}:due`;
      const soon = await redis.zrangebyscore(due, 0, Date.now() + 30_000);
      const all = await redis.zrangebyscore(due, 0, "+inf");
      return soon.length === 0 && all.length === 50;
    });

    const lrange = redis.lrange.bind(redis);
    redis.lrange = async (key: string, start: number, stop: number) => {
      if (key.includes(":history:")) reads++;

      return lrange(key, start, stop);
    };

    await sleep(300);

    expect(reads).toBe(0);

    await wf.stop();
  });

  test("a retry after backoff still respects retries", async () => {
    const redis = createRedis();
    const name = `retry-replay-${crypto.randomUUID()}`;
    let attempts = 0;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 2,
      retryBackoff: { baseDelay: 200, multiplier: 1, maxDelay: 200 },
      handler: async ({ step }) => {
        await step("flaky", async () => {
          attempts++;
          throw new Error(`boom ${attempts}`);
        });
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(() => attempts === 1);
    await sleep(100);
    expect(attempts).toBe(1);

    const execution = await waitStatus(wf, executionId, "failed");
    const history = await new WorkflowStore(redis, name).loadHistory(
      executionId,
    );
    const started = history
      .map((raw) => JSON.parse(raw) as { type: string; attempt?: number })
      .filter((event) => event.type === "StepStarted")
      .map((event) => event.attempt);

    expect(execution.error).toBe("boom 3");
    expect(attempts).toBe(3);
    expect(started).toEqual([1, 2, 3]);

    await sleep(250);
    expect(attempts).toBe(3);

    await wf.stop();
  });

  test("commit reports a cancel requested by another replica mid-step", async () => {
    const redis = createRedis();
    const name = `cancel-mid-step-${crypto.randomUUID()}`;
    const other = new WorkflowStore(redis, name);
    const ran: string[] = [];
    let abortedDuringStep: boolean | undefined;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      lockTTL: 60_000,
      handler: async ({ step, executionId }) => {
        await step("first", async ({ signal }) => {
          ran.push("first");
          // Another replica's cancel: meta flag only, no local abort here.
          await other.requestCancel(executionId);
          abortedDuringStep = signal.aborted;
          return 1;
        });

        await step("second", async () => {
          ran.push("second");
          return 2;
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(abortedDuringStep).toBe(false);
    expect(ran).toEqual(["first"]);
    expect(execution.steps.map((s) => s.name)).toEqual(["first"]);

    await wf.stop();
  });

  test("a cancel reported by StepStarted skips the step handler", async () => {
    const redis = createRedis();
    const name = `cancel-before-handler-${crypto.randomUUID()}`;
    const other = new WorkflowStore(redis, name);
    const ran: string[] = [];

    beforeCommit(async ({ executionId, events }) => {
      const startsSecond = events?.some(
        (event) => event.type === "StepStarted" && event.stepId === "a1",
      );

      if (startsSecond) await other.requestCancel(executionId);
    });

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      lockTTL: 60_000,
      handler: async ({ step }) => {
        await step("first", async () => {
          ran.push("first");
          return 1;
        });

        await step("second", async () => {
          ran.push("second");
          return 2;
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(ran).toEqual(["first"]);
    expect(execution.steps.map((s) => s.name)).toEqual(["first"]);

    await wf.stop();
  });

  test("stop keeps the in-flight step's result, stops polling and frees the name", async () => {
    const redis = createRedis();
    const name = `stop-${crypto.randomUUID()}`;
    let started = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        handler: async ({ step }) => {
          // Ignores the aborted signal and finishes anyway.
          await step("work", async () => {
            started++;
            await gate;
            return 1;
          });

          return "done";
        },
      });

    const wf = make();
    const { executionId } = await wf.start({});
    await waitFor(() => started === 1);

    const stopped = wf.stop();
    release();
    await stopped;

    // The step's result is kept, but the run goes no further.
    const execution = await wf.get(executionId);
    expect(execution.status).toBe("running");
    expect(execution.steps.map((s) => s.name)).toEqual(["work"]);

    const { executionId: queued } = await wf.start({});
    await sleep(100);
    expect((await wf.get(queued)).status).toBe("pending");

    const next = make();
    await waitStatus(next, executionId, "completed");
    await waitStatus(next, queued, "completed");

    // Once per execution: the kept result is not re-run.
    expect(started).toBe(2);

    await next.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
    });

    test("cancel on cancelled returns terminal status", async () => {
      const redis = createRedis();
      const { state, handler } = blockingStep();

      const wf = defineWorkflow({
        name: `cancel-twice-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler,
      });

      const { executionId } = await wf.start({});
      await waitFor(() => state.entered);
      await wf.cancel(executionId);
      state.released = true;
      await waitStatus(wf, executionId, "cancelled");

      const second = await wf.cancel(executionId);

      expect(second.status).toBe("cancelled");
      expect(second.executionId).toBe(executionId);

      await wf.stop();
    });

    test("cancel is a no-op when the run turns terminal or compensating first", async () => {
      for (const status of ["completed", "compensating"] as const) {
        const redis = createRedis();
        const name = `cancel-race-${status}-${crypto.randomUUID()}`;
        const metaKey = (id: string) => `workflow:${name}:meta:${id}`;
        let cancels = 0;

        const wf = defineWorkflow({
          name,
          redis,
          ...fast,
          hooks: {
            onCancel: () => {
              cancels++;
            },
          },
          handler: async ({ sleep: durableSleep }) => {
            await durableSleep(60_000);
          },
        });

        const { executionId } = await wf.start({});
        await waitStatus(wf, executionId, "running");

        // The run finishes (or starts unwinding) on another replica right
        // before the cancel script executes.
        const send = redis.send.bind(redis);
        redis.send = async (command: string, args: string[]) => {
          if (command === "EVAL" && args[0] === CANCEL_EXECUTION) {
            await redis.hset(metaKey(executionId), "status", status);
          }

          return send(command, args);
        };

        const result = await wf.cancel(executionId);

        expect(result.status).toBe(status);
        expect(
          (await redis.hgetall(metaKey(executionId))).cancelRequestedAt,
        ).toBe("");
        // Still due at the sleep's fireAt, not pulled forward.
        expect(
          await redis.zrangebyscore(`workflow:${name}:due`, 0, Date.now()),
        ).not.toContain(executionId);

        await sleep(50);

        expect((await wf.get(executionId)).status).toBe(status);
        expect(cancels).toBe(0);

        await wf.stop();
      }
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

      await wf.stop();
    });

    test("stale resume after complete does not revive execution", async () => {
      const redis = createRedis();
      let attempts = 0;
      let completes = 0;

      const wf = defineWorkflow({
        name: `resume-stale-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        hooks: {
          onComplete: () => {
            completes++;
          },
        },
        handler: async ({ step }) => {
          await step("once", async () => {
            attempts++;

            if (attempts === 1) throw new Error("boom");

            return "ok";
          });

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await wf.resume(executionId);
      await waitStatus(wf, executionId, "completed");

      await expect(wf.resume(executionId)).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: expect.stringContaining(
          "only failed executions can be resumed",
        ),
      });

      expect(attempts).toBe(2);
      expect(completes).toBe(1);
      expect((await wf.get(executionId)).status).toBe("completed");

      await wf.stop();
    });

    test("resume racing a completion leaves the terminal status alone", async () => {
      const redis = createRedis();
      const name = `resume-race-${crypto.randomUUID()}`;
      const store = new WorkflowStore(redis, name);

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("once", async () => {
            throw new Error("boom");
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");
      await wf.stop();

      const live = defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("once", async () => "ok");
        },
      });

      // Another replica completes the execution right before the resume
      // script runs.
      const send = redis.send.bind(redis);
      redis.send = async (command: string, args: string[]) => {
        if (command === "EVAL" && args[0] === RESUME_EXECUTION) {
          await redis.hset(
            `workflow:${name}:meta:${executionId}`,
            "status",
            "completed",
            "completedAt",
            String(Date.now()),
            "result",
            '"done"',
            "error",
            "",
            "failedAt",
            "",
          );
        }

        return send(command, args);
      };

      await expect(live.resume(executionId)).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: expect.stringContaining(
          "is completed, only failed executions can be resumed",
        ),
      });

      expect((await live.get(executionId)).status).toBe("completed");
      expect(
        await redis.zrangebyscore(`workflow:${name}:due`, 0, "+inf"),
      ).not.toContain(executionId);

      const history = await store.loadHistory(executionId);
      const resumed = history.some((raw) => {
        const event = JSON.parse(raw) as { type?: string };
        return event.type === "WorkflowResumed";
      });

      expect(resumed).toBe(false);

      await live.stop();
    });

    test("concurrent resumes apply exactly once", async () => {
      const redis = createRedis();
      const name = `resume-concurrent-${crypto.randomUUID()}`;
      const wf = failOnce(name, redis);
      const { executionId } = await wf.start({});

      await waitStatus(wf, executionId, "failed");

      const results = await Promise.allSettled([
        wf.resume(executionId),
        wf.resume(executionId),
        wf.resume(executionId),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(2);

      for (const result of rejected) {
        expect(result.reason).toMatchObject({
          name: "WorkflowStoreError",
          message: expect.stringContaining(
            "only failed executions can be resumed",
          ),
        });
      }

      const execution = await waitStatus(wf, executionId, "completed");
      expect(execution.result).toBe("ok");

      const history = await new WorkflowStore(redis, name).loadHistory(
        executionId,
      );
      const resumes = history.filter((raw) => {
        const event = JSON.parse(raw) as { type?: string };
        return event.type === "WorkflowResumed";
      });

      expect(resumes).toHaveLength(1);

      await wf.stop();
    });

    test("onError errorHistory after resume starts a new attempt series", async () => {
      const redis = createRedis();
      let attempts = 0;
      let lastHistory: { attempt: number; error: string }[] = [];

      const wf = defineWorkflow({
        name: `resume-error-history-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        hooks: {
          onError: ({ errorHistory }) => {
            lastHistory = errorHistory.map((entry) => ({
              attempt: entry.attempt,
              error: entry.error,
            }));
          },
        },
        handler: async ({ step }) => {
          await step("once", async () => {
            attempts++;

            if (attempts === 1) throw new Error("first");

            throw new Error("second");
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");
      expect(lastHistory).toEqual([{ attempt: 1, error: "first" }]);

      await wf.resume(executionId);
      await waitStatus(wf, executionId, "failed");

      expect(lastHistory).toEqual([{ attempt: 1, error: "second" }]);

      await wf.stop();
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
      );
      await redis.rpush(
        `workflow:${name}:history:${executionId}`,
        JSON.stringify({
          type: "WorkflowStarted",
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

      await wf.stop();
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
      await wf.stop();
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

      await wf.stop();
    });

    test("resume rejects cancelled executions", async () => {
      const redis = createRedis();
      const { state, handler } = blockingStep();

      const wf = defineWorkflow({
        name: `resume-cancelled-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler,
      });

      const { executionId } = await wf.start({});
      await waitFor(() => state.entered);
      await wf.cancel(executionId);
      state.released = true;
      await waitStatus(wf, executionId, "cancelled");

      await expect(wf.resume(executionId)).rejects.toMatchObject({
        name: "WorkflowStoreError",
        message: expect.stringContaining(
          "only failed executions can be resumed",
        ),
      });

      await wf.stop();
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

      await wf.stop();
    });

    test("get returns cancelledAt on cancelled workflow", async () => {
      const redis = createRedis();
      const { state, handler } = blockingStep();

      const wf = defineWorkflow({
        name: `get-cancelled-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler,
      });

      const { executionId } = await wf.start({});
      await waitFor(() => state.entered);
      await wf.cancel(executionId);
      state.released = true;

      const execution = await waitStatus(wf, executionId, "cancelled");

      expect(typeof execution.cancelledAt).toBe("number");
      expect(execution.completedAt).toBeNull();

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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
      expect(retryContexts[0]?.nextRetryDelayMs).toBe(10);
      expect(retryContexts[0]?.retriesRemaining).toBe(2);
      expect(retryContexts[1]?.attempt).toBe(2);
      expect(retryContexts[1]?.nextRetryDelayMs).toBe(20);
      expect(retryContexts[1]?.retriesRemaining).toBe(1);

      await wf.stop();
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
      await waitStatus(wf, executionId, "failed");

      expect(errorContexts.length).toBe(1);
      expect(errorContexts[0]?.stepName).toBe("flaky");
      expect(errorContexts[0]?.totalAttempts).toBe(2);
      expect(errorContexts[0]?.errorHistoryLength).toBe(2);

      await wf.stop();
    });

    test("fail() calls onError and skips onRetry", async () => {
      const redis = createRedis();
      let onRetryCalls = 0;
      const errorContexts: Array<{
        stepName: string;
        error: Error;
        totalAttempts: number;
      }> = [];

      class PermanentError extends Error {}

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
            fail(new PermanentError("permanent"));
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("permanent");
      expect(onRetryCalls).toBe(0);
      expect(errorContexts.length).toBe(1);
      expect(errorContexts[0]?.stepName).toBe("risky");
      expect(errorContexts[0]?.error).toBeInstanceOf(PermanentError);
      expect(errorContexts[0]?.error.message).toBe("permanent");
      expect(errorContexts[0]?.totalAttempts).toBe(1);

      await wf.stop();
    });

    test("calls lifecycle hooks on start, complete, and cancel", async () => {
      const redis = createRedis();
      const { state, handler } = blockingStep();
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
        handler,
      });

      const { executionId: cancelId } = await wfCancel.start({});
      await waitFor(() => state.entered);
      await wfCancel.cancel(cancelId);
      state.released = true;
      await waitStatus(wfCancel, cancelId, "cancelled");

      expect(events).toEqual(["start", "cancel"]);

      await wfCancel.stop();
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

      await wfComplete.stop();
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

      await wf.stop();
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

      await wf.stop();
    });

    test("onCancel hook errors do not change cancel outcome", async () => {
      const redis = createRedis();
      const { state, handler } = blockingStep();

      const wf = defineWorkflow({
        name: `hook-cancel-error-${crypto.randomUUID()}`,
        redis,
        ...fast,
        hooks: {
          onCancel: () => {
            throw new Error("cancel hook boom");
          },
        },
        handler,
      });

      const { executionId } = await wf.start({});
      await waitFor(() => state.entered);
      await wf.cancel(executionId);
      state.released = true;

      await waitStatus(wf, executionId, "cancelled");

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

        await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      expect(execution.error).toMatch(/serializ/i);

      await wf.stop();
    });

    test("fails and compensates when the workflow result cannot be serialized", async () => {
      const redis = createRedis();
      let undone = 0;

      const wf = defineWorkflow({
        name: `ser-result-err-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ step }) => {
          await step("made", async () => "made", {
            compensate: async () => {
              undone++;
            },
          });

          return 10n;
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("Unable to serialize result");
      expect(undone).toBe(1);

      await wf.stop();
    });
  });

  describe("partitions", () => {
    test("partitionKey without partitionBy is stored but shares the global pool", async () => {
      const redis = createRedis();
      const name = `psk-${crypto.randomUUID()}`;
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const options: WorkflowOptions<{ id: number }, string> = {
        name,
        redis,
        ...fast,
        concurrency: 1,
        handler: async ({ step }) => {
          await step("work", async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await sleep(50);
            currentConcurrent--;
            return "ok";
          });

          return "done";
        },
      };
      const wf = defineWorkflow(options);
      const other = replica(options);

      await wf.start({ id: 1 }, { executionId: "psk-1", partitionKey: "a" });
      await wf.start({ id: 2 }, { executionId: "psk-2", partitionKey: "b" });

      await waitStatus(wf, "psk-1", "completed");
      await waitStatus(wf, "psk-2", "completed");

      expect(maxConcurrent).toBe(1);
      expect(
        (await new WorkflowStore(redis, name).getMeta("psk-1"))?.partitionKey,
      ).toBe("a");

      await other.stop();
      await wf.stop();
    });

    // Partition tests park each execution in a durable sleep between two
    // steps: its slot stays held while the poller moves on to the next one.
    test("start partitionKey overrides partitionBy", async () => {
      const redis = createRedis();
      let active = 0;
      let maxActive = 0;

      const wf = defineWorkflow<{ envId: string }, string>({
        name: `pov-${crypto.randomUUID()}`,
        redis,
        ...fast,
        concurrency: 1,
        partitionBy: (input) => input.envId,
        handler: async ({ step, sleep: durableSleep }) => {
          await step("enter", async () => {
            active++;
            maxActive = Math.max(maxActive, active);
          });
          await durableSleep(100);
          await step("exit", async () => {
            active--;
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

      // partitionBy alone would put them on keys "a" and "b".
      expect(maxActive).toBe(1);

      await wf.stop();
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

      await wf.stop();
    });

    test("resume honors stored partitionKey", async () => {
      const redis = createRedis();
      let active = 0;
      let maxActive = 0;
      let failGate = true;
      let partitionFn = (input: { envId: string }) => input.envId;

      const wf = defineWorkflow<{ envId: string }, string>({
        name: `pr-${crypto.randomUUID()}`,
        redis,
        ...fast,
        concurrency: 1,
        partitionBy: (input) => partitionFn(input),
        retries: 0,
        handler: async ({ step, sleep: durableSleep }) => {
          await step("gate", async () => {
            if (failGate) throw new Error("boom");
          });
          await step("enter", async () => {
            active++;
            maxActive = Math.max(maxActive, active);
          });
          await durableSleep(100);
          await step("exit", async () => {
            active--;
          });

          return "done";
        },
      });

      await wf.start({ envId: "env-a" }, { executionId: "pr-1" });
      await waitStatus(wf, "pr-1", "failed");

      // Recomputing keys now would put pr-1 on "moved-env-a", pr-2 on
      // "moved-x"; the stored keys put both on "env-a".
      failGate = false;
      partitionFn = (input) => `moved-${input.envId}`;

      await wf.start(
        { envId: "x" },
        { executionId: "pr-2", partitionKey: "env-a" },
      );
      await wf.resume("pr-1");

      await waitStatus(wf, "pr-1", "completed");
      await waitStatus(wf, "pr-2", "completed");

      expect(maxActive).toBe(1);

      await wf.stop();
    });
  });

  describe("determinism", () => {
    test("handler that swallows errors still runs its steps and sleeps", async () => {
      const redis = createRedis();
      const calls: string[] = [];

      const wf = defineWorkflow({
        name: `swallow-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ step, sleep: durableSleep }) => {
          try {
            await step("charge", async () => {
              calls.push("charge");
            });
            await durableSleep(10);
          } catch {}

          try {
            await step("notify", async () => {
              calls.push("notify");
            });
          } catch (error) {
            throw new Error(`wrapped: ${(error as Error).message}`);
          }

          return "done";
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("done");
      expect(execution.steps.map((s) => s.name)).toEqual(["charge", "notify"]);
      expect(calls).toEqual(["charge", "notify"]);

      await wf.stop();
    });

    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      test(`sleep(${ms}) fails the run without recording a timer`, async () => {
        const redis = createRedis();
        const name = `bad-sleep-${crypto.randomUUID()}`;

        const wf = defineWorkflow({
          name,
          redis,
          ...fast,
          handler: async ({ sleep: durableSleep }) => {
            await durableSleep(ms);
            return "slept";
          },
        });

        const { executionId } = await wf.start({});
        const execution = await waitStatus(wf, executionId, "failed");

        expect(execution.error).toBe(
          "sleep(ms) requires a non-negative finite number",
        );
        expect(await eventTypes(redis, name, executionId)).not.toContain(
          "TimerStarted",
        );

        await wf.stop();
      });
    }

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

      await wf.stop();
    });

    test("a failed step renamed before resume fails as nondeterminism", async () => {
      const redis = createRedis();
      let renamed = false;
      let ran = 0;

      const wf = defineWorkflow({
        name: `nondet-resume-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step(renamed ? "beta" : "alpha", async () => {
            ran++;
            throw new Error("boom");
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      renamed = true;
      await wf.resume(executionId);
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe(
        'nondeterminism: step a0 expected "alpha", got "beta"',
      );
      expect(ran).toBe(1);

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf1.stop();
      await redis.del(`workflow:${name}:lease:${executionId}`);

      release = true;
      const wf2 = make();
      const execution = await waitStatus(wf2, executionId, "completed");

      expect(execution.result).toBe("done");
      expect(completes).toBe(1);

      await wf2.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
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

      await wf.resume(executionId);

      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("ok");
      expect(attempts).toBe(3);

      const history = await new WorkflowStore(redis, name).loadHistory(
        executionId,
      );
      const resumes = history.filter((raw) => {
        const event = JSON.parse(raw) as { type?: string };
        return event.type === "WorkflowResumed";
      });

      expect(resumes).toHaveLength(2);

      await wf.stop();
    });

    test("a resume landing mid-trim keeps the resumed execution", async () => {
      const redis = createRedis();
      const name = `retain-race-${crypto.randomUUID()}`;
      let attempts = 0;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        retentionTTL: 60_000,
        retentionMax: 1,
        handler: async ({ step }) => {
          return step("once", async () => {
            attempts++;

            if (attempts === 1) throw new Error("boom");

            return "ok";
          });
        },
      });

      const { executionId } = await wf.start({});

      await waitStatus(wf, executionId, "failed");

      // The resume lands after trim picked the execution and before the
      // script that unlinks it.
      const send = redis.send.bind(redis);
      let resumed = false;

      redis.send = async (command: string, args: string[]) => {
        if (!resumed && command === "EVAL" && args[0] === TRIM_IF_MEMBER) {
          resumed = true;
          await wf.resume(executionId);
        }

        return send(command, args);
      };

      await new WorkflowStore(redis, name).trimTerminal(0);

      expect(resumed).toBe(true);

      const execution = await waitStatus(wf, executionId, "completed");

      expect(execution.result).toBe("ok");

      await wf.stop();
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

      await wf.stop();
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

      await wf.stop();
    });
  });

  describe("compensate", () => {
    test("later step fail runs earlier compensations LIFO", async () => {
      const redis = createRedis();
      const order: string[] = [];

      const wf = defineWorkflow({
        name: `saga-lifo-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step(
            "create-vm",
            async () => {
              order.push("create-vm");
              return { id: "vm-1" };
            },
            {
              compensate: async ({ result }) => {
                order.push(`terminate:${result?.id}`);
              },
            },
          );

          await step(
            "attach-volume",
            async () => {
              order.push("attach-volume");
              return { id: "vol-1" };
            },
            {
              compensate: async ({ result }) => {
                order.push(`detach:${result?.id}`);
              },
            },
          );

          await step("provision", async () => {
            order.push("provision");
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("provision failed");
      expect(order).toEqual([
        "create-vm",
        "attach-volume",
        "provision",
        "detach:vol-1",
        "terminate:vm-1",
      ]);

      await wf.stop();
    });

    test("steps without compensate fail with the step error", async () => {
      const redis = createRedis();
      const order: string[] = [];

      const wf = defineWorkflow({
        name: `saga-none-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("create-vm", async () => {
            order.push("create-vm");
            return { id: "vm-1" };
          });

          await step("provision", async () => {
            order.push("provision");
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("provision failed");
      expect(order).toEqual(["create-vm", "provision"]);

      await wf.stop();
    });

    test("crash mid-compensation resumes without re-running completed compensations", async () => {
      const redis = createRedis();
      const order: string[] = [];
      const name = `saga-crash-${crypto.randomUUID()}`;
      let hangDetach = true;
      let crashHang = true;

      const make = () =>
        defineWorkflow({
          name,
          redis,
          ...fast,
          retries: 0,
          lockTTL: 60,
          handler: async ({ step }) => {
            await step(
              "create-vm",
              async () => {
                order.push("create-vm");
                return { id: "vm-1" };
              },
              {
                compensate: async ({ result }) => {
                  order.push(`terminate:${result?.id}`);
                },
              },
            );

            await step(
              "attach-volume",
              async () => {
                order.push("attach-volume");
                return { id: "vol-1" };
              },
              {
                compensate: async ({ result }) => {
                  order.push(`detach:${result?.id}`);

                  if (hangDetach) {
                    hangDetach = false;

                    while (crashHang) {
                      await sleep(10);
                    }

                    throw new Error("crashed");
                  }
                },
              },
            );

            await step("provision", async () => {
              order.push("provision");
              throw new Error("provision failed");
            });
          },
        });

      const wf1 = make();
      const { executionId } = await wf1.start({});

      await waitFor(() => order.includes("detach:vol-1"));

      await expireLeases(redis);
      crashHang = false;
      await wf1.stop();

      const wf2 = make();
      const execution = await waitStatus(wf2, executionId, "failed");

      expect(execution.error).toBe("provision failed");
      expect(order.filter((item) => item.startsWith("detach:")).length).toBe(2);
      expect(order.filter((item) => item.startsWith("terminate:")).length).toBe(
        1,
      );

      await wf2.stop();
    });

    test("compensation retries then succeeds", async () => {
      const redis = createRedis();
      let compensateAttempts = 0;

      const wf = defineWorkflow({
        name: `saga-retry-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 2,
        handler: async ({ step }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async () => {
              compensateAttempts++;

              if (compensateAttempts < 2) {
                throw new Error("terminate busy");
              }
            },
          });

          await step("provision", async () => {
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("provision failed");
      expect(compensateAttempts).toBe(2);

      await wf.stop();
    });

    test("compensation retries exhaust then fail with compensation error", async () => {
      const redis = createRedis();
      let compensateAttempts = 0;

      const wf = defineWorkflow({
        name: `saga-retry-fail-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 1,
        handler: async ({ step }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async () => {
              compensateAttempts++;
              throw new Error("terminate down");
            },
          });

          await step("provision", async () => {
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("terminate down");
      expect(compensateAttempts).toBe(2);

      await wf.stop();
    });

    test("cancel after completed steps compensates then cancelled", async () => {
      const redis = createRedis();
      const order: string[] = [];
      let compensateSignalAborted: boolean | undefined;

      const wf = defineWorkflow({
        name: `saga-cancel-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step, sleep: durableSleep }) => {
          await step(
            "create-vm",
            async () => {
              order.push("create-vm");
              return { id: "vm-1" };
            },
            {
              compensate: async ({ result, signal }) => {
                compensateSignalAborted = signal.aborted;
                order.push(`terminate:${result?.id}`);
              },
            },
          );

          await durableSleep(10_000);
        },
      });

      const { executionId } = await wf.start({});

      await waitFor(async () => {
        const execution = await wf.get(executionId);
        return execution.steps.some((step) => step.name === "create-vm");
      });

      await wf.cancel(executionId);
      await waitStatus(wf, executionId, "cancelled");

      expect(order).toEqual(["create-vm", "terminate:vm-1"]);
      expect(compensateSignalAborted).toBe(false);

      await wf.stop();
    });

    test("status is compensating while unwind runs", async () => {
      const redis = createRedis();
      let hang = true;

      const wf = defineWorkflow({
        name: `saga-status-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async ({ signal }) => {
              while (hang) {
                if (signal.aborted) return;
                await sleep(10);
              }
            },
          });

          await step("provision", async () => {
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "compensating");
      hang = false;
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("provision failed");

      await wf.stop();
    });

    test("resume after compensation is rejected", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `saga-resume-block-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async () => {},
          });

          await step("provision", async () => {
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await expect(wf.resume(executionId)).rejects.toThrow(
        "cannot be resumed after compensation",
      );

      await wf.stop();
    });

    test("handler throw after completed step still compensates", async () => {
      const redis = createRedis();
      const order: string[] = [];

      const wf = defineWorkflow({
        name: `saga-throw-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step(
            "create-vm",
            async () => {
              order.push("create-vm");
              return { id: "vm-1" };
            },
            {
              compensate: async ({ result }) => {
                order.push(`terminate:${result?.id}`);
              },
            },
          );

          throw new Error("oops");
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("oops");
      expect(order).toEqual(["create-vm", "terminate:vm-1"]);

      await wf.stop();
    });

    test("cancel during sleep then crash still compensates without waiting leftover sleep", async () => {
      const redis = createRedis();
      const order: string[] = [];
      const name = `saga-sleep-crash-${crypto.randomUUID()}`;
      let hangTerminate = true;
      let crashHang = true;

      const make = () =>
        defineWorkflow({
          name,
          redis,
          ...fast,
          retries: 0,
          lockTTL: 60,
          handler: async ({ step, sleep: durableSleep }) => {
            await step(
              "create-vm",
              async () => {
                order.push("create-vm");
                return { id: "vm-1" };
              },
              {
                compensate: async ({ result }) => {
                  order.push(`terminate:${result?.id}`);

                  if (hangTerminate) {
                    hangTerminate = false;

                    while (crashHang) {
                      await sleep(10);
                    }

                    throw new Error("crashed");
                  }
                },
              },
            );

            await durableSleep(10_000);
          },
        });

      const wf1 = make();
      const { executionId } = await wf1.start({});

      await waitFor(async () => {
        const execution = await wf1.get(executionId);
        return execution.steps.some((step) => step.name === "create-vm");
      });

      await wf1.cancel(executionId);
      await waitStatus(wf1, executionId, "compensating");

      await expireLeases(redis);
      crashHang = false;
      await wf1.stop();

      const wf2 = make();
      await waitStatus(wf2, executionId, "cancelled");

      expect(order.filter((item) => item.startsWith("terminate:")).length).toBe(
        2,
      );

      await wf2.stop();
    });

    test("a cancel reported by the sleep's wait commit keeps the visibility timeout during the unwind", async () => {
      const redis = createRedis();
      const name = `saga-sleep-cancel-race-${crypto.randomUUID()}`;
      const other = new WorkflowStore(redis, name);
      const lockTTL = 60_000;
      const sleepMs = 60 * 60_000;
      let cancelled = false;
      let dueDuringUndo: { score: number; limit: number } | undefined;

      // The cancel lands right before the commit of due = fireAt, so that
      // commit overwrites the cancel's own due score and reports the cancel.
      // lockTTL is long, so no heartbeat runs while the test is going.
      beforeCommit(async ({ executionId, dueAt }) => {
        if (cancelled || dueAt === undefined) return;
        if (dueAt <= Date.now() + lockTTL) return;

        cancelled = true;
        await other.requestCancel(executionId);
      });

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL,
        handler: async ({ step, sleep: durableSleep, executionId }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async () => {
              const score = await redis.zscore(
                `workflow:${name}:due`,
                executionId,
              );

              dueDuringUndo = {
                score: Number(score),
                limit: Date.now() + lockTTL,
              };
            },
          });

          await durableSleep(sleepMs);
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "cancelled");

      expect(cancelled).toBe(true);
      expect(execution.cancelledAt).not.toBeNull();
      expect(dueDuringUndo).toBeDefined();
      expect(dueDuringUndo?.score).toBeLessThanOrEqual(
        dueDuringUndo?.limit ?? 0,
      );

      await wf.stop();
    });

    test("fail() inside compensate is non-retryable", async () => {
      const redis = createRedis();
      let compensateAttempts = 0;

      const wf = defineWorkflow({
        name: `saga-fail-comp-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 2,
        handler: async ({ step }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async ({ fail }) => {
              compensateAttempts++;
              fail(new Error("cannot undo"));
            },
          });

          await step("provision", async () => {
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("cannot undo");
      expect(compensateAttempts).toBe(1);

      await wf.stop();
    });

    test("cancel while compensating is a no-op and unwind finishes", async () => {
      const redis = createRedis();
      let hang = true;
      let compensateRuns = 0;

      const wf = defineWorkflow({
        name: `saga-cancel-during-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async () => {
              compensateRuns++;

              while (hang) {
                await sleep(10);
              }
            },
          });

          await step("provision", async () => {
            throw new Error("provision failed");
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "compensating");

      const requested = await wf.cancel(executionId);

      expect(requested.status).toBe("compensating");

      hang = false;
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("provision failed");
      expect(compensateRuns).toBe(1);

      await wf.stop();
    });

    test("cancel-initiated compensate exhaust ends failed without onCancel", async () => {
      const redis = createRedis();
      let onCancelCalls = 0;
      let compensateAttempts = 0;

      const wf = defineWorkflow({
        name: `saga-cancel-exhaust-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 1,
        hooks: {
          onCancel: () => {
            onCancelCalls++;
          },
        },
        handler: async ({ step, sleep: durableSleep }) => {
          await step("create-vm", async () => ({ id: "vm-1" }), {
            compensate: async () => {
              compensateAttempts++;
              throw new Error("terminate down");
            },
          });

          await durableSleep(10_000);
        },
      });

      const { executionId } = await wf.start({});

      await waitFor(async () => {
        const execution = await wf.get(executionId);
        return execution.steps.some((step) => step.name === "create-vm");
      });

      await wf.cancel(executionId);
      const execution = await waitStatus(wf, executionId, "failed");

      expect(execution.error).toBe("terminate down");
      expect(compensateAttempts).toBe(2);
      expect(onCancelCalls).toBe(0);

      await wf.stop();
    });

    test("stop during an unwind returns after the current undo step", async () => {
      const redis = createRedis();
      const name = `saga-stop-lifo-${crypto.randomUUID()}`;
      let hang = true;
      let detachAborted: boolean | undefined;
      const order: string[] = [];

      const make = () =>
        defineWorkflow({
          name,
          redis,
          ...fast,
          retries: 0,
          handler: async ({ step }) => {
            await step(
              "create-vm",
              async () => {
                order.push("create-vm");
                return { id: "vm-1" };
              },
              {
                compensate: async () => {
                  order.push("terminate");
                },
              },
            );

            await step(
              "attach-volume",
              async () => {
                order.push("attach-volume");
                return { id: "vol-1" };
              },
              {
                compensate: async ({ signal }) => {
                  order.push("detach");

                  while (hang) {
                    await sleep(10);
                  }

                  detachAborted = signal.aborted;
                },
              },
            );

            await step("provision", async () => {
              throw new Error("provision failed");
            });
          },
        });

      const wf = make();
      const { executionId } = await wf.start({});
      await waitFor(() => order.includes("detach"));

      const done = wf.stop();
      hang = false;
      await done;

      // stop() waited for the running undo only, without aborting it; the
      // unwind is unfinished.
      expect(detachAborted).toBe(false);
      expect(order).toEqual(["create-vm", "attach-volume", "detach"]);
      expect((await wf.get(executionId)).status).toBe("compensating");

      const next = make();
      const execution = await waitStatus(next, executionId, "failed");

      expect(order).toEqual([
        "create-vm",
        "attach-volume",
        "detach",
        "terminate",
      ]);
      expect(execution.error).toBe("provision failed");

      await next.stop();
    });
  });

  describe("startSync", () => {
    test("waits for completed result", async () => {
      const redis = createRedis();

      const wf = defineWorkflow<{ value: number }, { doubled: number }>({
        name: `sync-ok-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ input, step }) => {
          const doubled = await step("double", async () => input.value * 2);
          return { doubled };
        },
      });

      const result = await awaitStartSync(wf.startSync({ value: 21 }));

      expect(result.status).toBe("completed");
      expect(result.result).toEqual({ doubled: 42 });
      expect(result.error).toBeNull();

      await wf.stop();
    });

    test("attaches to existing executionId instead of throwing", async () => {
      const redis = createRedis();

      const wf = defineWorkflow<{ value: number }, { doubled: number }>({
        name: `sync-attach-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ input, step }) => {
          const doubled = await step("double", async () => input.value * 2);
          return { doubled };
        },
      });

      await wf.start({ value: 3 }, { executionId: "child-1" });

      const result = await awaitStartSync(
        wf.startSync({ value: 3 }, { executionId: "child-1" }),
      );

      expect(result.executionId).toBe("child-1");
      expect(result.status).toBe("completed");
      expect(result.result).toEqual({ doubled: 6 });

      await wf.stop();
    });

    test("propagates validation errors instead of attaching", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `sync-validate-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await wf.start({}, { executionId: "exists" });

      await expect(
        wf.startSync({}, { executionId: "exists", partitionKey: "" }),
      ).rejects.toBeInstanceOf(WorkflowStoreError);

      await wf.stop();
    });

    test("returns Error with failure message", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `sync-fail-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("boom", async () => {
            throw new NonRetryableStepError("hard stop");
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(result.status).toBe("failed");
      expect(result.result).toBeNull();
      expect(result.error).toBeInstanceOf(NonRetryableStepError);
      expect(result.error?.message).toBe("hard stop");

      await wf.stop();
    });

    test("revives registered subclass with instanceof on startSync", async () => {
      const redis = createRedis();

      class CardDeclinedError extends Error {}

      const wf = defineWorkflow({
        name: `sync-typed-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        errors: [CardDeclinedError],
        handler: async ({ step }) => {
          await step("charge", async ({ fail }) => {
            fail(new CardDeclinedError("card declined"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(result.status).toBe("failed");
      expect(result.error).toBeInstanceOf(CardDeclinedError);
      expect(result.error?.message).toBe("card declined");

      const failed = (
        await new WorkflowStore(redis, wf.name).loadHistory(result.executionId)
      )
        .map((raw) => JSON.parse(raw) as { type: string; errorName?: string })
        .find((event) => event.type === "StepFailed");

      expect(failed?.errorName).toBe("CardDeclinedError");

      await wf.stop();
    });

    test("unregistered subclass keeps durable name under warn mode", async () => {
      const redis = createRedis();

      class CardDeclinedError extends Error {}

      const wf = defineWorkflow({
        name: `sync-unreg-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("charge", async ({ fail }) => {
            fail(new CardDeclinedError("card declined"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(result.status).toBe("failed");
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error).not.toBeInstanceOf(CardDeclinedError);
      expect(result.error?.name).toBe("CardDeclinedError");

      await wf.stop();
    });

    test("unregisteredErrors error replaces with UnregisteredWorkflowError", async () => {
      const redis = createRedis();

      class CardDeclinedError extends Error {}

      const wf = defineWorkflow({
        name: `sync-unreg-err-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        unregisteredErrors: "error",
        handler: async ({ step }) => {
          await step("charge", async ({ fail }) => {
            fail(new CardDeclinedError("card declined"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(result.error).toBeInstanceOf(UnregisteredWorkflowError);
      expect(result.error?.message).toContain("CardDeclinedError");

      await wf.stop();
    });

    test("onError receives live registered instance and startSync revives it", async () => {
      const redis = createRedis();

      class CardDeclinedError extends Error {}
      let hooked: Error | undefined;

      const wf = defineWorkflow({
        name: `sync-onerror-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        errors: [CardDeclinedError],
        hooks: {
          onError: ({ error }) => {
            hooked = error;
          },
        },
        handler: async ({ step }) => {
          await step("charge", async ({ fail }) => {
            fail(new CardDeclinedError("live"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(hooked).toBeInstanceOf(CardDeclinedError);
      expect(result.error).toBeInstanceOf(CardDeclinedError);

      await wf.stop();
    });

    test("empty registered failure message survives startSync", async () => {
      const redis = createRedis();

      class CardDeclinedError extends Error {}

      const wf = defineWorkflow({
        name: `sync-empty-msg-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        errors: [CardDeclinedError],
        handler: async ({ step }) => {
          await step("charge", async ({ fail }) => {
            fail(new CardDeclinedError(""));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(result.error?.message).toBe("");
      expect(result.error).toBeInstanceOf(CardDeclinedError);

      await wf.stop();
    });

    test("startSync after compensate keeps registered originalError", async () => {
      const redis = createRedis();

      class ProvisionError extends Error {}

      const wf = defineWorkflow({
        name: `sync-comp-orig-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        errors: [ProvisionError],
        handler: async ({ step }) => {
          await step("create", async () => "acct", {
            compensate: async () => {},
          });

          await step("provision", async ({ fail }) => {
            fail(new ProvisionError("provision failed"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(result.error).toBeInstanceOf(ProvisionError);
      expect(result.error?.message).toBe("provision failed");

      await wf.stop();
    });

    test("resume then fail again keeps registered instanceof", async () => {
      const redis = createRedis();

      class FlakyError extends Error {}
      let attempts = 0;

      const wf = defineWorkflow({
        name: `sync-resume-fail-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        retentionTTL: 60_000,
        errors: [FlakyError],
        handler: async ({ step }) => {
          await step("once", async ({ fail }) => {
            attempts++;

            if (attempts === 1) {
              fail(new FlakyError("first"));
            }

            fail(new FlakyError("second"));
          });
        },
      });

      const { executionId } = await wf.start({});
      await waitStatus(wf, executionId, "failed");

      await wf.resume(executionId);

      const result = await awaitStartSync(wf.startSync({}, { executionId }));

      expect(result.error).toBeInstanceOf(FlakyError);
      expect(result.error?.message).toBe("second");
      expect(attempts).toBe(2);

      await wf.stop();
    });

    test("returns original failure after compensation, not compensate error", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `sync-comp-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("create", async () => "acct", {
            compensate: async () => {
              throw new Error("undo failed");
            },
          });

          await step("provision", async () => {
            throw new NonRetryableStepError("provision failed");
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(result.status).toBe("failed");
      expect(result.error).toBeInstanceOf(NonRetryableStepError);
      expect(result.error?.message).toBe("provision failed");

      const execution = await wf.get(result.executionId);
      expect(execution.error).toBe("undo failed");

      await wf.stop();
    });

    test("timeout returns timeout and cancelOnTimeout requests cancel", async () => {
      const redis = createRedis();

      const wf = defineWorkflow({
        name: `sync-timeout-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ sleep }) => {
          await sleep(60_000);
        },
      });

      const result = await awaitStartSync(
        wf.startSync(
          {},
          {
            executionId: "slow-1",
            timeoutMs: 40,
            cancelOnTimeout: true,
          },
        ),
      );

      expect(result.status).toBe("timeout");
      expect(result.result).toBeNull();
      expect(result.error).toBeNull();

      await waitStatus(wf, "slow-1", "cancelled");

      await wf.stop();
    });

    test("rejects invalid timeoutMs", async () => {
      const redis = createRedis();
      const name = `sync-timeout-bad-${crypto.randomUUID()}`;

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        handler: async () => "ok",
      });

      await expect(
        wf.startSync({}, { timeoutMs: Number.NaN }),
      ).rejects.toBeInstanceOf(WorkflowStoreError);
      await expect(wf.startSync({}, { timeoutMs: -1 })).rejects.toBeInstanceOf(
        WorkflowStoreError,
      );

      expect(await listWorkflows(redis, { name })).toEqual([]);

      await wf.stop();
    });

    test("parent step memoizes child startSync across replay", async () => {
      const redis = createRedis();
      const parentName = `sync-parent-${crypto.randomUUID()}`;
      let childStepRuns = 0;
      let parentStepRuns = 0;
      let release = false;

      const child = defineWorkflow<{ n: number }, { n: number }>({
        name: `sync-child-${crypto.randomUUID()}`,
        redis,
        ...fast,
        handler: async ({ input, step }) => {
          await step("work", async () => {
            childStepRuns++;
            return input.n;
          });
          return { n: input.n };
        },
      });

      const makeParent = () =>
        defineWorkflow<Record<string, never>, { n: number }>({
          name: parentName,
          redis,
          ...fast,
          lockTTL: 40,
          handler: async ({ step }) => {
            const synced = await step("call-child", async () => {
              parentStepRuns++;
              const result = await child.startSync(
                { n: 7 },
                { executionId: "memo-child" },
              );

              if (result.status !== "completed") {
                throw new Error(`child ${result.status}`);
              }

              if (!result.result) {
                throw new Error("missing child result");
              }

              return result.result;
            });

            await step("hold", async ({ signal }) => {
              while (!release && !signal.aborted) {
                await sleep(10);
              }

              return "ok";
            });

            return synced;
          },
        });

      const parent = makeParent();
      const { executionId } = await parent.start({});

      await waitFor(async () => {
        const execution = await parent.get(executionId);
        return execution.steps.some((step) => step.name === "call-child");
      });

      expect(childStepRuns).toBe(1);
      expect(parentStepRuns).toBe(1);

      await parent.stop();
      await redis.del(`workflow:${parentName}:lease:${executionId}`);

      release = true;
      const parent2 = makeParent();
      const execution = await waitStatus(parent2, executionId, "completed");

      expect(execution.result).toEqual({ n: 7 });
      expect(childStepRuns).toBe(1);
      expect(parentStepRuns).toBe(1);

      await parent2.stop();
      await child.stop();
    });

    test("polls meta without reading history", async () => {
      const redis = createRedis();
      const name = `sync-meta-poll-${crypto.randomUUID()}`;
      const historyKey = `workflow:${name}:history:polled`;
      let reads = 0;
      let entered = false;
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const lrange = redis.lrange.bind(redis);
      redis.lrange = async (key: string, start: number, stop: number) => {
        if (key === historyKey) reads++;

        return lrange(key, start, stop);
      };

      const wf = defineWorkflow({
        name,
        redis,
        ...fast,
        lockTTL: 60_000,
        handler: async ({ step }) => {
          return step("gated", async () => {
            entered = true;
            await gate;
            return "done";
          });
        },
      });

      const pending = wf.startSync({}, { executionId: "polled" });

      await waitFor(() => entered);
      // Several poll intervals pass while the step is blocked.
      await sleep(100);
      release();

      const result = await awaitStartSync(pending);

      expect(result.status).toBe("completed");
      expect(result.result).toBe("done");
      // Only the lease holder's single read at claim time.
      expect(reads).toBe(1);

      await wf.stop();
    });
  });

  describe("durable error identity adversarial", () => {
    test("fail() unregistered under error mode stays non-retryable with retries", async () => {
      const redis = createRedis();
      let attempts = 0;
      let hooked: Error | undefined;

      class UnlistedFailError extends Error {}

      const wf = defineWorkflow({
        name: `adv-fail-noretry-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 2,
        unregisteredErrors: "error",
        hooks: {
          onError: ({ error }) => {
            hooked = error;
          },
          onRetry: () => {
            throw new Error("should not retry fail()");
          },
        },
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            attempts++;
            fail(new UnlistedFailError("no retry"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(attempts).toBe(1);
      expect(hooked).toBeInstanceOf(UnregisteredWorkflowError);
      expect(result.error).toBeInstanceOf(UnregisteredWorkflowError);

      await wf.stop();
    });

    test("warn once for many failures of same unregistered class", async () => {
      const redis = createRedis();
      const warns: string[] = [];
      const warnSpy = spyOn(console, "warn").mockImplementation(
        (message: string) => {
          warns.push(message);
        },
      );

      class RepeatError extends Error {}

      const wf = defineWorkflow({
        name: `adv-warn-once-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new RepeatError("again"));
          });
        },
      });

      await awaitStartSync(wf.startSync({}));
      await awaitStartSync(wf.startSync({}));
      await awaitStartSync(wf.startSync({}));

      const related = warns.filter((message) =>
        message.includes("RepeatError"),
      );

      expect(related).toHaveLength(1);

      warnSpy.mockRestore();
      await wf.stop();
    });

    test("warn once isolation across separate workflow instances", async () => {
      const redis = createRedis();
      const warns: string[] = [];
      const warnSpy = spyOn(console, "warn").mockImplementation(
        (message: string) => {
          warns.push(message);
        },
      );

      class SharedNameError extends Error {}

      const wfA = defineWorkflow({
        name: `adv-warn-a-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new SharedNameError("a"));
          });
        },
      });

      const wfB = defineWorkflow({
        name: `adv-warn-b-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new SharedNameError("b"));
          });
        },
      });

      await awaitStartSync(wfA.startSync({}));
      await awaitStartSync(wfB.startSync({}));

      const related = warns.filter((message) =>
        message.includes("SharedNameError"),
      );

      expect(related).toHaveLength(2);

      warnSpy.mockRestore();
      await wfA.stop();
      await wfB.stop();
    });

    test("get().error is string while startSync.error is Error instance", async () => {
      const redis = createRedis();

      class TypedFailError extends Error {}

      const wf = defineWorkflow({
        name: `adv-get-str-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        errors: [TypedFailError],
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new TypedFailError("typed boom"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));
      const execution = await wf.get(result.executionId);

      expect(typeof execution.error).toBe("string");
      expect(execution.error).toBe("typed boom");
      expect(result.error).toBeInstanceOf(TypedFailError);
      expect(result.error?.message).toBe("typed boom");

      await wf.stop();
    });

    test("onError gets live unregistered instance before registry", async () => {
      const redis = createRedis();

      class LiveOnlyError extends Error {}
      let hooked: Error | undefined;

      const wf = defineWorkflow({
        name: `adv-onerror-live-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        hooks: {
          onError: ({ error }) => {
            hooked = error;
          },
        },
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new LiveOnlyError("live"));
          });
        },
      });

      const result = await awaitStartSync(wf.startSync({}));

      expect(hooked).toBeInstanceOf(LiveOnlyError);
      expect(result.error).not.toBeInstanceOf(LiveOnlyError);
      expect(result.error?.name).toBe("LiveOnlyError");

      await wf.stop();
    });

    test("plain Error and NonRetryableStepError need no errors listing", async () => {
      const redis = createRedis();

      const plain = defineWorkflow({
        name: `adv-plain-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        unregisteredErrors: "error",
        handler: async ({ step }) => {
          await step("boom", async () => {
            throw new Error("plain");
          });
        },
      });

      const nonRetry = defineWorkflow({
        name: `adv-nr-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        unregisteredErrors: "error",
        handler: async ({ step }) => {
          await step("boom", async () => {
            throw new NonRetryableStepError("nr");
          });
        },
      });

      const plainResult = await awaitStartSync(plain.startSync({}));
      const nrResult = await awaitStartSync(nonRetry.startSync({}));

      expect(plainResult.error).toBeInstanceOf(Error);
      expect(plainResult.error).not.toBeInstanceOf(UnregisteredWorkflowError);
      expect(plainResult.error?.message).toBe("plain");
      expect(nrResult.error).toBeInstanceOf(NonRetryableStepError);
      expect(nrResult.error?.message).toBe("nr");

      await plain.stop();
      await nonRetry.stop();
    });

    test("error-mode startSync throws when reviving unknown name from history", async () => {
      const redis = createRedis();
      const name = `adv-revive-throw-${crypto.randomUUID()}`;

      class GhostError extends Error {}

      const writer = defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        unregisteredErrors: "warn",
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new GhostError("ghost"));
          });
        },
      });

      const written = await awaitStartSync(
        writer.startSync({}, { executionId: "ghost-1" }),
      );

      expect(written.status).toBe("failed");
      await writer.stop();

      const reader = defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        unregisteredErrors: "error",
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new GhostError("ghost"));
          });
        },
      });

      let thrown: unknown;

      try {
        await reader.startSync({}, { executionId: "ghost-1" });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UnregisteredWorkflowError);
      expect((thrown as Error).message).toContain("GhostError");

      await reader.stop();
    });

    test("cancelled startSync does not revive a false Error", async () => {
      const redis = createRedis();
      const { state, handler } = blockingStep();

      class NeverError extends Error {}

      const wf = defineWorkflow({
        name: `adv-cancel-${crypto.randomUUID()}`,
        redis,
        ...fast,
        errors: [NeverError],
        handler,
      });

      const pending = wf.startSync({}, { executionId: "cancel-me" });

      await waitFor(() => state.entered);
      await wf.cancel("cancel-me");
      state.released = true;

      const result = await awaitStartSync(pending);

      expect(result.status).toBe("cancelled");
      expect(result.error).toBeNull();
      expect(result.result).toBeNull();

      await wf.stop();
    });

    test("fail() registered and throw registered produce same durable name", async () => {
      const redis = createRedis();

      class SameError extends Error {}

      const viaFail = defineWorkflow({
        name: `adv-same-fail-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        errors: [SameError],
        handler: async ({ step }) => {
          await step("boom", async ({ fail }) => {
            fail(new SameError("via-fail"));
          });
        },
      });

      const viaThrow = defineWorkflow({
        name: `adv-same-throw-${crypto.randomUUID()}`,
        redis,
        ...fast,
        retries: 0,
        errors: [SameError],
        handler: async ({ step }) => {
          await step("boom", async () => {
            throw new SameError("via-throw");
          });
        },
      });

      const failResult = await awaitStartSync(viaFail.startSync({}));
      const throwResult = await awaitStartSync(viaThrow.startSync({}));

      const failEvent = (
        await new WorkflowStore(redis, viaFail.name).loadHistory(
          failResult.executionId,
        )
      )
        .map((raw) => JSON.parse(raw) as { type: string; errorName?: string })
        .find((event) => event.type === "StepFailed");

      const throwEvent = (
        await new WorkflowStore(redis, viaThrow.name).loadHistory(
          throwResult.executionId,
        )
      )
        .map((raw) => JSON.parse(raw) as { type: string; errorName?: string })
        .find((event) => event.type === "StepFailed");

      expect(failEvent?.errorName).toBe("SameError");
      expect(throwEvent?.errorName).toBe("SameError");
      expect(failResult.error).toBeInstanceOf(SameError);
      expect(throwResult.error).toBeInstanceOf(SameError);

      await viaFail.stop();
      await viaThrow.stop();
    });
  });
});

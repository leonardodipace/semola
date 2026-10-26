import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WorkflowEngine } from "./engine.js";
import {
  closeRedis,
  createRedis,
  resetRedis,
  SEMOLA_REDIS_URL,
} from "./integration-helpers.js";
import { WorkflowStore } from "./store.js";
import type { WorkflowHandlerContext, WorkflowMeta } from "./types.js";

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

const baseMeta = (name: string, input = "{}"): WorkflowMeta => ({
  name,
  status: "pending",
  input,
  result: "",
  error: "",
  createdAt: String(Date.now()),
  updatedAt: String(Date.now()),
  completedAt: "",
  failedAt: "",
  cancelledAt: "",
  partitionKey: "",
  cancelRequestedAt: "",
});

describe.skipIf(!SEMOLA_REDIS_URL)("WorkflowEngine", () => {
  beforeEach(resetRedis);
  afterEach(closeRedis);

  test("runs a queued execution to completion", async () => {
    const redis = createRedis();
    const name = `engine-happy-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    const calls: string[] = [];

    const engine = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 5,
        lockTTL: 60_000,
        handler: async ({ step }) => {
          const value = await step("work", async () => {
            calls.push("work");
            return 42;
          });

          return value;
        },
      },
      store,
    );

    engine.start();

    const executionId = "e1";
    await store.createExecution(executionId, baseMeta(name));

    await waitFor(async () => {
      const meta = await store.getMeta(executionId);
      return meta?.status === "completed";
    });

    const meta = await store.getMeta(executionId);
    expect(meta?.result).toBe("42");
    expect(calls).toEqual(["work"]);

    const done = engine.stop();
    await sleep(50);
    await done;
  });

  test("stop aborts in-flight work and ends polling", async () => {
    const redis = createRedis();
    const name = `engine-stop-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    let started = false;
    let sawAbort = false;

    const engine = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 5,
        lockTTL: 60_000,
        handler: async ({ step }) => {
          await step("hang", async ({ signal }) => {
            started = true;

            while (!signal.aborted) {
              await sleep(10);
            }

            sawAbort = true;
            throw new Error("aborted");
          });
        },
      },
      store,
    );

    engine.start();

    const executionId = "e2";
    await store.createExecution(executionId, baseMeta(name));

    await waitFor(() => started);

    const done = engine.stop();
    await sleep(100);
    await done;

    expect(sawAbort).toBe(true);
  });

  test("requestAbort aborts the execution signal", async () => {
    const redis = createRedis();
    const name = `engine-abort-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    let started = false;
    let aborted = false;

    const engine = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 5,
        lockTTL: 60_000,
        handler: async ({ step }) => {
          await step("hang", async ({ signal }) => {
            started = true;

            while (!signal.aborted) {
              await sleep(10);
            }

            aborted = true;
            throw new Error("cancelled");
          });
        },
      },
      store,
    );

    engine.start();

    const executionId = "e3";
    await store.createExecution(executionId, baseMeta(name));

    // Only a run in flight in this engine can be aborted.
    await waitFor(() => started);
    engine.requestAbort(executionId);

    await waitFor(() => aborted);

    const done = engine.stop();
    await sleep(50);
    await done;

    expect(aborted).toBe(true);
  });

  // cancel() calls requestAbort in whichever process handles the request.
  test("requestAbort for an execution this engine is not running leaves nothing behind", async () => {
    const redis = createRedis();
    const name = `engine-abort-idle-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    const abortedAtStart: boolean[] = [];

    const engine = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 5,
        lockTTL: 60_000,
        handler: async ({ step }) => {
          await step("work", async ({ signal }) => {
            abortedAtStart.push(signal.aborted);
          });
        },
      },
      store,
    );

    const executionId = "e-idle";
    engine.requestAbort(executionId);

    await store.createExecution(executionId, baseMeta(name));
    engine.start();

    await waitFor(async () => {
      const meta = await store.getMeta(executionId);
      return meta?.status === "completed";
    });

    expect(abortedAtStart).toEqual([false]);

    const done = engine.stop();
    await sleep(50);
    await done;
  });

  test("durable sleep schedules timer then completes after fire", async () => {
    const redis = createRedis();
    const name = `engine-sleep-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);

    const engine = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 5,
        lockTTL: 60_000,
        handler: async ({ sleep }) => {
          await sleep(50);
          return "slept";
        },
      },
      store,
    );

    engine.start();

    const executionId = "e4";
    await store.createExecution(executionId, baseMeta(name));

    await sleep(20);

    expect((await store.getMeta(executionId))?.status).not.toBe("completed");

    await waitFor(async () => {
      const meta = await store.getMeta(executionId);
      return meta?.status === "completed";
    }, 5000);

    expect((await store.getMeta(executionId))?.result).toBe('"slept"');

    const done = engine.stop();
    await sleep(50);
    await done;
  });

  test("stop returns after another replica finishes compensation", async () => {
    const redis = createRedis();
    const name = `engine-stale-comp-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    let compensateAttempts = 0;

    const handler = async ({ step }: WorkflowHandlerContext<unknown>) => {
      await step("create-vm", async () => ({ id: "vm-1" }), {
        compensate: async () => {
          compensateAttempts++;

          if (compensateAttempts < 2) {
            throw new Error("terminate busy");
          }
        },
      });

      await step("provision", async ({ fail }) => {
        fail(new Error("provision failed"));
      });
    };

    const engineA = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 60_000,
        lockTTL: 60_000,
        retentionTTL: Number.POSITIVE_INFINITY,
        retries: 1,
        retryBackoff: { baseDelay: 10_000, multiplier: 1, maxDelay: 10_000 },
        handler,
      },
      store,
    );

    const engineB = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 5,
        lockTTL: 60_000,
        retentionTTL: Number.POSITIVE_INFINITY,
        retries: 1,
        retryBackoff: { baseDelay: 5, multiplier: 1, maxDelay: 5 },
        handler,
      },
      new WorkflowStore(redis, name),
    );

    const executionId = "e-stale";
    await store.createExecution(executionId, baseMeta(name));

    engineA.start();

    await waitFor(() => compensateAttempts >= 1);

    engineB.start();
    // Hand the compensate retry to engineB now instead of after A's backoff.
    await redis.zadd(`workflow:${name}:due`, Date.now(), executionId);

    await waitFor(async () => {
      if (compensateAttempts < 2) return false;

      const meta = await store.getMeta(executionId);

      if (!meta) return true;

      return meta.status === "failed";
    });

    expect(compensateAttempts).toBe(2);

    const meta = await store.getMeta(executionId);
    expect(meta?.status).toBe("failed");
    expect(meta?.error).toBe("provision failed");

    const doneA = engineA.stop();
    await sleep(100);
    await doneA;

    const doneB = engineB.stop();
    await sleep(50);
    await doneB;
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { WorkflowEngine } from "./engine.js";
import { createRedis } from "./redis.mock.js";
import { WorkflowStore } from "./store.js";
import type { WorkflowMeta } from "./types.js";

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
  partitionSlot: "",
  concurrencySlot: "",
});

describe("WorkflowEngine", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("rejects invalid timeout", () => {
    const redis = createRedis();
    const name = `engine-bad-timeout-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    const base = {
      name,
      redis,
      handler: async () => {},
    };

    expect(
      () => new WorkflowEngine({ ...base, timeout: Number.NaN }, store),
    ).toThrow("timeout must be a positive finite number or Infinity");

    expect(() => new WorkflowEngine({ ...base, timeout: -1 }, store)).toThrow(
      "timeout must be a positive finite number or Infinity",
    );

    expect(() => new WorkflowEngine({ ...base, timeout: 0 }, store)).toThrow(
      "timeout must be a positive finite number or Infinity",
    );

    expect(
      () =>
        new WorkflowEngine(
          { ...base, timeout: Number.NEGATIVE_INFINITY },
          store,
        ),
    ).toThrow("timeout must be a positive finite number or Infinity");
  });

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
    await store.tryCreateMetaAndActive(executionId, baseMeta(name));
    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: Date.now(),
        },
      ],
    });
    await store.enqueue(executionId);

    await waitFor(async () => {
      const meta = await store.getMeta(executionId);
      return meta?.status === "completed";
    });

    const meta = await store.getMeta(executionId);
    expect(meta?.result).toBe("42");
    expect(calls).toEqual(["work"]);

    const done = engine.stop();
    await advanceTimersByTimeAsync(50);
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
        timeout: Infinity,
        handler: async ({ step }) => {
          await step("hang", async ({ signal }) => {
            started = true;

            while (!signal.aborted) {
              await advanceTimersByTimeAsync(10);
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
    await store.tryCreateMetaAndActive(executionId, baseMeta(name));
    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: Date.now(),
        },
      ],
    });
    await store.enqueue(executionId);

    await waitFor(() => started);

    const done = engine.stop();
    await advanceTimersByTimeAsync(100);
    await done;

    expect(sawAbort).toBe(true);
  });

  test("requestAbort aborts the execution signal", async () => {
    const redis = createRedis();
    const name = `engine-abort-${crypto.randomUUID()}`;
    const store = new WorkflowStore(redis, name);
    let aborted = false;

    const engine = new WorkflowEngine(
      {
        name,
        redis,
        pollInterval: 5,
        lockTTL: 60_000,
        timeout: Infinity,
        handler: async ({ step }) => {
          await step("hang", async ({ signal }) => {
            while (!signal.aborted) {
              await advanceTimersByTimeAsync(10);
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
    await store.tryCreateMetaAndActive(executionId, baseMeta(name));
    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: Date.now(),
        },
      ],
    });
    await store.enqueue(executionId);

    await advanceTimersByTimeAsync(20);
    engine.requestAbort(executionId);

    await waitFor(() => aborted);

    const done = engine.stop();
    await advanceTimersByTimeAsync(50);
    await done;

    expect(aborted).toBe(true);
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
    await store.tryCreateMetaAndActive(executionId, baseMeta(name));
    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: Date.now(),
        },
      ],
    });
    await store.enqueue(executionId);

    await advanceTimersByTimeAsync(20);

    expect((await store.getMeta(executionId))?.status).not.toBe("completed");

    await waitFor(async () => {
      const meta = await store.getMeta(executionId);
      return meta?.status === "completed";
    }, 5000);

    expect((await store.getMeta(executionId))?.result).toBe('"slept"');

    const done = engine.stop();
    await advanceTimersByTimeAsync(50);
    await done;
  });
});

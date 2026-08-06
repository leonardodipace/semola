import { describe, expect, test } from "bun:test";
import { createRedis } from "./redis.mock.js";
import { WorkflowStore } from "./store.js";
import type { WorkflowMeta } from "./types.js";

const baseMeta = (name: string): WorkflowMeta => ({
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
  partitionKey: "",
  partitionSlot: "",
  concurrencySlot: "",
});

describe("WorkflowStore", () => {
  test("tryCreateMetaAndActive creates once then rejects duplicate", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-create");
    const executionId = "exec-1";

    const first = await store.tryCreateMetaAndActive(
      executionId,
      baseMeta("store-create"),
    );
    const second = await store.tryCreateMetaAndActive(
      executionId,
      baseMeta("store-create"),
    );

    expect(first).toBe(true);
    expect(second).toBe(false);

    const meta = await store.getMeta(executionId);
    expect(meta?.status).toBe("pending");

    const active = await store.listActive();
    expect(active).toContain(executionId);
  });

  test("appendEvents without lease and loadHistory roundtrip", async () => {
    const store = new WorkflowStore(createRedis(), "store-history");
    const executionId = "exec-2";

    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: 1,
        },
      ],
    });

    await store.appendEvents({
      executionId,
      events: [
        {
          type: "WorkflowCompleted",
          result: '"ok"',
          timestamp: 2,
        },
      ],
    });

    const history = await store.loadHistory(executionId);

    expect(history).toHaveLength(2);
    expect(JSON.parse(history[0] ?? "{}").type).toBe("WorkflowStarted");
    expect(JSON.parse(history[1] ?? "{}").type).toBe("WorkflowCompleted");
  });

  test("appendEvents with lease fences wrong token", async () => {
    const store = new WorkflowStore(createRedis(), "store-fence");
    const executionId = "exec-3";

    await store.acquireLease({
      executionId,
      token: "owner",
      ttlMs: 60_000,
    });

    const ok = await store.appendEvents({
      executionId,
      leaseToken: "owner",
      events: [
        {
          type: "WorkflowStarted",
          input: "{}",
          partitionKey: "",
          timestamp: 1,
        },
      ],
    });

    const blocked = await store.appendEvents({
      executionId,
      leaseToken: "intruder",
      events: [
        {
          type: "WorkflowFailed",
          error: "nope",
          timestamp: 2,
        },
      ],
    });

    expect(ok).toBe(true);
    expect(blocked).toBe(false);
    expect(await store.loadHistory(executionId)).toHaveLength(1);
  });

  test("enqueue and dequeue are FIFO via lpush/rpop", async () => {
    const store = new WorkflowStore(createRedis(), "store-queue");

    await store.enqueue("a");
    await store.enqueue("b");

    expect(await store.dequeue()).toBe("a");
    expect(await store.dequeue()).toBe("b");
    expect(await store.dequeue()).toBeNull();
  });

  test("lease acquire extend release and ownership", async () => {
    const store = new WorkflowStore(createRedis(), "store-lease");
    const executionId = "exec-4";

    expect(
      await store.acquireLease({
        executionId,
        token: "t1",
        ttlMs: 60_000,
      }),
    ).toBe(true);

    expect(
      await store.acquireLease({
        executionId,
        token: "t2",
        ttlMs: 60_000,
      }),
    ).toBe(false);

    expect(await store.getLease(executionId)).toBe("t1");

    expect(
      await store.extendLease({
        executionId,
        token: "t1",
        ttlMs: 60_000,
      }),
    ).toBe(true);

    expect(
      await store.extendLease({
        executionId,
        token: "t2",
        ttlMs: 60_000,
      }),
    ).toBe(false);

    await store.releaseLease(executionId, "t2");
    expect(await store.getLease(executionId)).toBe("t1");

    await store.releaseLease(executionId, "t1");
    expect(await store.getLease(executionId)).toBeNull();
  });

  test("timers schedule claim and scheduleIfAbsent", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-timers");
    const task = {
      kind: "timer" as const,
      executionId: "exec-5",
      timerId: "t0",
    };

    await store.scheduleTimer(Date.now() - 1, task);

    const claimed = await store.claimDueTimer(Date.now());
    expect(claimed).toBe(JSON.stringify(task));
    expect(await store.claimDueTimer(Date.now())).toBeNull();

    const added = await store.scheduleTimerIfAbsent(Date.now() + 1000, task);
    const again = await store.scheduleTimerIfAbsent(Date.now() + 2000, task);

    expect(added).toBe(true);
    expect(again).toBe(false);
  });

  test("zrangebyscore orders equal scores lexicographically", async () => {
    const redis = createRedis();

    await redis.zadd("z", 1, "b-member");
    await redis.zadd("z", 1, "a-member");
    await redis.zadd("z", 0, "z-first");

    expect(await redis.zrangebyscore("z", 0, 2)).toEqual([
      "z-first",
      "a-member",
      "b-member",
    ]);
  });

  test("concurrent claimDueTimer never returns the same timer twice", async () => {
    const store = new WorkflowStore(createRedis(), "store-timer-race");
    const now = Date.now();
    const taskA = {
      kind: "timer" as const,
      executionId: "exec-a",
      timerId: "t0",
    };
    const taskB = {
      kind: "timer" as const,
      executionId: "exec-b",
      timerId: "t1",
    };

    await store.scheduleTimer(now - 2, taskA);
    await store.scheduleTimer(now - 1, taskB);

    const results = await Promise.all([
      store.claimDueTimer(now),
      store.claimDueTimer(now),
      store.claimDueTimer(now),
    ]);

    const claimed = results.filter((value) => value !== null);

    expect(claimed).toHaveLength(2);
    expect(new Set(claimed).size).toBe(2);
    expect(await store.claimDueTimer(now)).toBeNull();
  });

  test("concurrent tryCreateMetaAndActive creates once", async () => {
    const store = new WorkflowStore(createRedis(), "store-create-race");
    const executionId = "exec-race";
    const meta = baseMeta("store-create-race");

    const results = await Promise.all([
      store.tryCreateMetaAndActive(executionId, meta),
      store.tryCreateMetaAndActive(executionId, meta),
      store.tryCreateMetaAndActive(executionId, meta),
    ]);

    expect(results.filter((value) => value)).toHaveLength(1);
    expect(await store.getMeta(executionId)).not.toBeNull();
  });

  test("deadLetterTimer stores corrupt payloads", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-dead");

    await store.deadLetterTimer("not-json");

    expect(redis.getList("workflow:store-dead:timer-dead")).toEqual([
      "not-json",
    ]);
  });

  test("partition claim refresh reown and release", async () => {
    const store = new WorkflowStore(createRedis(), "store-part");

    const slot = await store.claimPartition({
      partitionKey: "env-a",
      executionId: "exec-a",
      concurrency: 1,
      ttlMs: 60_000,
    });

    expect(slot).toBe(0);

    expect(
      await store.claimPartition({
        partitionKey: "env-a",
        executionId: "exec-b",
        concurrency: 1,
        ttlMs: 60_000,
      }),
    ).toBeNull();

    expect(
      await store.refreshPartition({
        partitionKey: "env-a",
        slot: 0,
        executionId: "exec-a",
        ttlMs: 60_000,
      }),
    ).toBe(true);

    expect(
      await store.claimPartition({
        partitionKey: "env-a",
        executionId: "exec-a",
        concurrency: 1,
        ttlMs: 60_000,
      }),
    ).toBe(0);

    await store.releasePartition({
      partitionKey: "env-a",
      slot: 0,
      executionId: "exec-a",
    });

    expect(
      await store.claimPartition({
        partitionKey: "env-a",
        executionId: "exec-b",
        concurrency: 1,
        ttlMs: 60_000,
      }),
    ).toBe(0);
  });

  test("setMeta and updateStatus with and without lease", async () => {
    const store = new WorkflowStore(createRedis(), "store-meta");
    const executionId = "exec-6";

    await store.tryCreateMetaAndActive(executionId, baseMeta("store-meta"));

    await store.setMeta({
      executionId,
      fields: { error: "boom" },
    });

    expect((await store.getMeta(executionId))?.error).toBe("boom");

    await store.acquireLease({
      executionId,
      token: "owner",
      ttlMs: 60_000,
    });

    expect(
      await store.updateStatus({
        executionId,
        status: "running",
        leaseToken: "owner",
      }),
    ).toBe(true);

    expect(
      await store.updateStatus({
        executionId,
        status: "failed",
        leaseToken: "intruder",
        extra: { error: "hacked" },
      }),
    ).toBe(false);

    const meta = await store.getMeta(executionId);
    expect(meta?.status).toBe("running");
    expect(meta?.error).toBe("boom");
  });

  test("updateStatusAndMarkActive flips status and adds to active", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-resume-active");
    const executionId = "exec-resume";

    await store.tryCreateMetaAndActive(executionId, {
      ...baseMeta("store-resume-active"),
      status: "failed",
      failedAt: String(Date.now()),
    });

    await store.markInactive(executionId);

    await store.updateStatusAndMarkActive({
      executionId,
      status: "pending",
      extra: {
        error: "",
        failedAt: "",
      },
    });

    const meta = await store.getMeta(executionId);
    expect(meta?.status).toBe("pending");
    expect(meta?.failedAt).toBe("");
    expect(await store.listActive()).toContain(executionId);
  });

  test("markActive markInactive and empty getMeta", async () => {
    const store = new WorkflowStore(createRedis(), "store-active");

    expect(await store.getMeta("missing")).toBeNull();

    await store.markActive("x");
    expect(await store.listActive()).toEqual(["x"]);

    await store.markInactive("x");
    expect(await store.listActive()).toEqual([]);
  });

  test("appendEvents with empty list is a no-op success", async () => {
    const store = new WorkflowStore(createRedis(), "store-empty");

    expect(
      await store.appendEvents({
        executionId: "exec-7",
        events: [],
      }),
    ).toBe(true);

    expect(await store.loadHistory("exec-7")).toEqual([]);
  });
});

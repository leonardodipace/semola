import { describe, expect, test } from "bun:test";
import { createRedis } from "./redis.mock.js";
import { keys, WorkflowStore } from "./store.js";
import type { WorkflowMeta } from "./types.js";

const baseMeta = (name: string) =>
  ({
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
  }) satisfies WorkflowMeta;

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

    expect(redis.getList(keys.timerDead("store-dead"))).toEqual(["not-json"]);
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

  test("getMeta wraps redis read failures", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-meta-fail");

    redis.failNext("hgetall");

    await expect(store.getMeta("exec-x")).rejects.toMatchObject({
      name: "WorkflowStoreError",
      message: "Unable to read meta for exec-x",
    });
  });

  test("loadHistory wraps redis read failures", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-history-fail");

    redis.failNext("lrange");

    await expect(store.loadHistory("exec-y")).rejects.toMatchObject({
      name: "WorkflowStoreError",
      message: "Unable to load history for exec-y",
    });
  });

  test("enqueue wraps redis write failures", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-enqueue-fail");

    redis.failNext("lpush");

    await expect(store.enqueue("exec-z")).rejects.toMatchObject({
      name: "WorkflowStoreError",
      message: "Unable to enqueue workflow task for exec-z",
    });
  });

  test("expireExecution sets TTL on meta and history", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-expire");
    const executionId = "exec-ttl";

    await store.tryCreateMetaAndActive(executionId, baseMeta("store-expire"));
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

    await store.expireExecution(executionId, 60_000);

    expect(
      await redis.pttl(keys.meta("store-expire", executionId)),
    ).toBeGreaterThan(0);
    expect(
      await redis.pttl(keys.history("store-expire", executionId)),
    ).toBeGreaterThan(0);
    expect(await redis.pttl(keys.lease("store-expire", executionId))).toBe(-2);
  });

  test("expireExecution with ttl 0 unlinks meta history and lease", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-expire-0");
    const executionId = "exec-gone";

    await store.tryCreateMetaAndActive(executionId, baseMeta("store-expire-0"));
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
    await store.acquireLease({
      executionId,
      token: "t1",
      ttlMs: 60_000,
    });

    await store.expireExecution(executionId, 0);

    expect(await redis.pttl(keys.meta("store-expire-0", executionId))).toBe(-2);
    expect(await redis.pttl(keys.history("store-expire-0", executionId))).toBe(
      -2,
    );
    expect(await redis.pttl(keys.lease("store-expire-0", executionId))).toBe(
      -2,
    );
    expect(await store.listActive()).not.toContain(executionId);
  });

  test("persistExecution removes TTL without marking active", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-persist");
    const executionId = "exec-persist";

    await store.tryCreateMetaAndActive(executionId, baseMeta("store-persist"));
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
    await store.expireExecution(executionId, 60_000);
    await store.markInactive(executionId);
    await store.persistExecution(executionId);

    expect(await redis.pttl(keys.meta("store-persist", executionId))).toBe(-1);
    expect(await redis.pttl(keys.history("store-persist", executionId))).toBe(
      -1,
    );
    expect(await store.listActive()).not.toContain(executionId);
  });

  test("retainIfTerminal without ttl does not expire", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-retain-none");
    const executionId = "exec-keep";

    await store.tryCreateMetaAndActive(executionId, {
      ...baseMeta("store-retain-none"),
      status: "completed",
      completedAt: String(Date.now()),
    });

    expect(
      await store.retainIfTerminal({
        executionId,
        endedAt: 1,
      }),
    ).toBe(true);

    expect(await redis.pttl(keys.meta("store-retain-none", executionId))).toBe(
      -1,
    );
    expect(await store.getMeta(executionId)).not.toBeNull();
  });

  test("trimTerminal unlinks oldest executions over max", async () => {
    const store = new WorkflowStore(createRedis(), "store-trim");

    await store.tryCreateMetaAndActive("old", baseMeta("store-trim"));
    await store.tryCreateMetaAndActive("mid", baseMeta("store-trim"));
    await store.tryCreateMetaAndActive("new", baseMeta("store-trim"));

    await store.rememberTerminal("old", 1);
    await store.rememberTerminal("mid", 2);
    await store.rememberTerminal("new", 3);
    await store.trimTerminal(2);

    expect(await store.getMeta("old")).toBeNull();
    expect(await store.getMeta("mid")).not.toBeNull();
    expect(await store.getMeta("new")).not.toBeNull();
  });

  test("scheduleTimerIfAbsent after timer zset expiry reschedules", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-timer-expire");
    const task = {
      kind: "timer" as const,
      executionId: "exec-t",
      timerId: "t0",
    };

    expect(await store.scheduleTimerIfAbsent(Date.now() + 1000, task)).toBe(
      true,
    );
    expect(await store.scheduleTimerIfAbsent(Date.now() + 2000, task)).toBe(
      false,
    );

    await redis.pexpire(keys.timers("store-timer-expire"), 0);

    expect(await store.scheduleTimerIfAbsent(Date.now() + 1000, task)).toBe(
      true,
    );
  });

  test("scanMetaIds keeps id when workflow name contains :meta:", async () => {
    const name = "has:meta:in-name";
    const store = new WorkflowStore(createRedis(), name);

    await store.tryCreateMetaAndActive("exec-1", baseMeta(name));

    const scanned = await store.scanMetaIds("0");

    expect(scanned.ids).toEqual(["exec-1"]);
  });

  test("retainIfTerminal skips after persistExecution leaves terminal status", async () => {
    const redis = createRedis();
    const store = new WorkflowStore(redis, "store-retain-race");
    const executionId = "exec-race";

    await store.tryCreateMetaAndActive(executionId, {
      ...baseMeta("store-retain-race"),
      status: "failed",
      failedAt: String(Date.now()),
    });
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

    expect(await store.persistExecution(executionId)).toBe(true);
    expect(
      await store.retainIfTerminal({
        executionId,
        ttlMs: 0,
      }),
    ).toBe(false);

    expect(await store.getMeta(executionId)).not.toBeNull();
    expect((await store.getMeta(executionId))?.status).toBe("pending");
  });

  test("retainIfTerminal ttl 0 unlinks before persistExecution", async () => {
    const store = new WorkflowStore(createRedis(), "store-retain-first");
    const executionId = "exec-gone";

    await store.tryCreateMetaAndActive(executionId, {
      ...baseMeta("store-retain-first"),
      status: "failed",
      failedAt: String(Date.now()),
    });

    expect(
      await store.retainIfTerminal({
        executionId,
        ttlMs: 0,
      }),
    ).toBe(true);

    expect(await store.persistExecution(executionId)).toBe(false);
    expect(await store.getMeta(executionId)).toBeNull();
  });

  test("concurrent persistExecution and retainIfTerminal 0 keep resume or unlink", async () => {
    const store = new WorkflowStore(createRedis(), "store-retain-par");
    const executionId = "exec-par";

    await store.tryCreateMetaAndActive(executionId, {
      ...baseMeta("store-retain-par"),
      status: "failed",
      failedAt: String(Date.now()),
    });

    await Promise.all([
      store.persistExecution(executionId),
      store.retainIfTerminal({
        executionId,
        ttlMs: 0,
      }),
    ]);

    const meta = await store.getMeta(executionId);

    if (meta) {
      expect(meta.status).toBe("pending");
    }
  });

  test("trim cannot delete execution after persistExecution removes terminal member", async () => {
    const store = new WorkflowStore(createRedis(), "store-trim-race");

    await store.tryCreateMetaAndActive("old", {
      ...baseMeta("store-trim-race"),
      status: "failed",
    });
    await store.tryCreateMetaAndActive("newer", {
      ...baseMeta("store-trim-race"),
      status: "failed",
    });
    await store.rememberTerminal("old", 1);
    await store.rememberTerminal("newer", 2);

    expect(await store.persistExecution("old")).toBe(true);
    await store.trimTerminal(1);

    expect(await store.getMeta("old")).not.toBeNull();
    expect((await store.getMeta("old"))?.status).toBe("pending");
    expect(await store.getMeta("newer")).not.toBeNull();
  });

  test("concurrent persistExecution and trimTerminal never unlink after persist", async () => {
    const store = new WorkflowStore(createRedis(), "store-trim-par");

    await store.tryCreateMetaAndActive("old", {
      ...baseMeta("store-trim-par"),
      status: "failed",
    });
    await store.tryCreateMetaAndActive("newer", {
      ...baseMeta("store-trim-par"),
      status: "failed",
    });
    await store.rememberTerminal("old", 1);
    await store.rememberTerminal("newer", 2);

    await Promise.all([store.persistExecution("old"), store.trimTerminal(1)]);

    const old = await store.getMeta("old");
    const newer = await store.getMeta("newer");

    expect(newer).not.toBeNull();

    if (old) {
      expect(old.status).toBe("pending");
    }
  });
});

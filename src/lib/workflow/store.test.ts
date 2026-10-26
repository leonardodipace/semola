import { describe, expect, test } from "bun:test";
import { createRedis, type MockRedisClient } from "./redis.mock.js";
import { COMMIT, keys, WorkflowStore } from "./store.js";
import type { CommitRetention, WorkflowMeta } from "./types.js";

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
    cancelRequestedAt: "",
  }) satisfies WorkflowMeta;

const dueIds = (redis: MockRedisClient, name: string) =>
  redis.zrangebyscore(keys.due(name), -Infinity, Infinity);

const parse = (rows: string[]) =>
  rows.map((raw) => JSON.parse(raw) as { type: string });

const commitFailed = async (
  store: WorkflowStore,
  executionId: string,
  retention: CommitRetention = {},
) => {
  await store.claimDue("owner", 60_000);

  const committed = await store.commit({
    executionId,
    leaseToken: "owner",
    events: [{ type: "WorkflowFailed", error: "boom", timestamp: 2 }],
    fields: { status: "failed", error: "boom", failedAt: "2" },
    retention,
  });

  await store.releaseLease(executionId, "owner");

  return committed;
};

const createFailed = async (
  store: WorkflowStore,
  name: string,
  executionId: string,
  retention: CommitRetention = {},
) => {
  await store.createExecution(executionId, baseMeta(name));
  await commitFailed(store, executionId, retention);
};

describe("WorkflowStore", () => {
  test("createExecution writes meta, WorkflowStarted and a due entry together", async () => {
    const redis = createRedis();
    const name = "store-create";
    const store = new WorkflowStore(redis, name);
    const meta = { ...baseMeta(name), input: '{"a":1}', partitionKey: "p" };

    expect(await store.createExecution("exec-1", meta)).toBe(true);
    expect(
      await store.createExecution("exec-1", { ...meta, input: '{"a":2}' }),
    ).toBe(false);

    expect((await store.getMeta("exec-1"))?.input).toBe('{"a":1}');
    expect(
      (await store.loadHistory("exec-1")).map((raw) => JSON.parse(raw)),
    ).toEqual([
      {
        type: "WorkflowStarted",
        input: '{"a":1}',
        partitionKey: "p",
        timestamp: Number(meta.createdAt),
      },
    ]);
    expect(await dueIds(redis, name)).toEqual(["exec-1"]);
    expect(await dueIds(redis, name)).toEqual(["exec-1"]);
  });

  test("createExecution writes nothing when redis rejects the script", async () => {
    const redis = createRedis();
    const name = "store-create-fail";
    const store = new WorkflowStore(redis, name);

    redis.failNext("send");

    await expect(
      store.createExecution("exec-1", baseMeta(name)),
    ).rejects.toMatchObject({
      name: "WorkflowStoreError",
      message: "Unable to create execution exec-1",
    });

    expect(await store.getMeta("exec-1")).toBeNull();
    expect(await store.loadHistory("exec-1")).toEqual([]);
    expect(await dueIds(redis, name)).toEqual([]);
    expect(await dueIds(redis, name)).toEqual([]);
  });

  test("createExecution drops a stale terminal zset member for a reused id", async () => {
    const redis = createRedis();
    const name = "store-create-reuse";
    const store = new WorkflowStore(redis, name);

    await redis.zadd(keys.terminal(name), 1, "exec-1");
    await store.createExecution("exec-1", baseMeta(name));
    await store.trimTerminal(0);

    expect(await store.getMeta("exec-1")).not.toBeNull();
    expect(await dueIds(redis, name)).toEqual(["exec-1"]);
  });

  test("claimDue leases one due execution and pushes its due score out", async () => {
    const redis = createRedis();
    const name = "store-claim";
    const store = new WorkflowStore(redis, name);
    const score = async (id: string) => {
      const rows = await redis.zrangebyscore(keys.due(name), 0, Date.now());
      return rows.includes(id);
    };

    await store.createExecution("e1", baseMeta(name));
    await redis.zadd(keys.due(name), 1, "ghost");

    const [first, second] = await Promise.all([
      store.claimDue("t1", 60_000),
      store.claimDue("t2", 60_000),
    ]);

    expect(first).toBe("e1");
    expect(second).toBeNull();
    expect(await store.getLease("e1")).toBe("t1");
    expect(await score("e1")).toBe(false);
    expect(await dueIds(redis, name)).toEqual(["e1"]);

    expect(
      await store.extendLease({ executionId: "e1", token: "t2", ttlMs: 1 }),
    ).toBe(false);
    expect(
      await store.extendLease({
        executionId: "e1",
        token: "t1",
        ttlMs: 60_000,
      }),
    ).toBe(true);

    await store.releaseLease("e1", "t2", Date.now());
    expect(await store.getLease("e1")).toBe("t1");

    await store.releaseLease("e1", "t1", Date.now());
    expect(await store.getLease("e1")).toBeNull();
    expect(await score("e1")).toBe(true);

    // Release only ever lowers the score: it stays at the claim's +60s.
    await store.claimDue("t3", 60_000);
    await store.releaseLease("e1", "t3", Date.now() + 120_000);
    expect(
      await redis.zrangebyscore(keys.due(name), 0, Date.now() + 60_000),
    ).toEqual(["e1"]);
  });

  test("concurrent createExecution creates once", async () => {
    const redis = createRedis();
    const name = "store-create-race";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-race";
    const meta = baseMeta(name);

    const results = await Promise.all([
      store.createExecution(executionId, meta),
      store.createExecution(executionId, meta),
      store.createExecution(executionId, meta),
    ]);

    expect(results.filter((value) => value)).toHaveLength(1);
    expect(await store.getMeta(executionId)).not.toBeNull();
    expect(await store.loadHistory(executionId)).toHaveLength(1);
    expect(await dueIds(redis, name)).toEqual([executionId]);
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

  test("commit writes events and meta only while holding the lease", async () => {
    const redis = createRedis();
    const name = "store-commit-fence";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-fence";

    await store.createExecution(executionId, baseMeta(name));
    await store.claimDue("owner", 60_000);

    const blocked = await store.commit({
      executionId,
      leaseToken: "intruder",
      events: [{ type: "WorkflowCompleted", result: '"x"', timestamp: 2 }],
      fields: { status: "completed", result: '"x"' },
      retention: { ttlMs: 0 },
    });

    expect(blocked).toEqual({ committed: false });
    expect((await store.getMeta(executionId))?.status).toBe("pending");
    expect(await store.loadHistory(executionId)).toHaveLength(1);
    expect(await dueIds(redis, name)).toEqual([executionId]);

    const ok = await store.commit({
      executionId,
      leaseToken: "owner",
      events: [
        {
          type: "CompensationStarted",
          reason: "failed",
          error: "boom",
          stepIds: ["a0"],
          timestamp: 2,
        },
      ],
      fields: { status: "compensating", error: "boom" },
    });

    expect(ok).toEqual({ committed: true, cancelRequested: false });
    expect((await store.getMeta(executionId))?.status).toBe("compensating");
    expect(parse(await store.loadHistory(executionId)).at(-1)?.type).toBe(
      "CompensationStarted",
    );
    expect(await dueIds(redis, name)).toEqual([executionId]);
    expect(await redis.pttl(keys.meta(name, executionId))).toBe(-1);
  });

  test("terminal commit appends, updates meta, leaves the due set and retains in one call", async () => {
    const redis = createRedis();
    const name = "store-commit-terminal";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-done";

    await store.createExecution(executionId, baseMeta(name));
    await store.claimDue("owner", 60_000);

    const committed = await store.commit({
      executionId,
      leaseToken: "owner",
      events: [{ type: "WorkflowCompleted", result: '"ok"', timestamp: 5 }],
      fields: { status: "completed", result: '"ok"', completedAt: "5" },
      retention: { ttlMs: 60_000, trackedAt: 5 },
    });

    expect(committed).toEqual({ committed: true, cancelRequested: false });

    const meta = await store.getMeta(executionId);
    expect(meta?.status).toBe("completed");
    expect(meta?.result).toBe('"ok"');
    expect(
      parse(await store.loadHistory(executionId)).map((e) => e.type),
    ).toEqual(["WorkflowStarted", "WorkflowCompleted"]);
    expect(await dueIds(redis, name)).toEqual([]);
    expect(await redis.pttl(keys.meta(name, executionId))).toBeGreaterThan(0);
    expect(await redis.pttl(keys.history(name, executionId))).toBeGreaterThan(
      0,
    );
    expect(
      await redis.send("ZRANGE", [keys.terminal(name), "0", "-1"]),
    ).toEqual([executionId]);
    expect(await store.getLease(executionId)).toBe("owner");
  });

  test("terminal commit sends an integer ttl so PEXPIRE cannot abort the script", async () => {
    const redis = createRedis();
    const name = "store-commit-frac";
    const store = new WorkflowStore(redis, name);
    const ttlArgs: string[] = [];
    const send = redis.send.bind(redis);

    redis.send = async (command: string, args: string[]) => {
      if (command === "EVAL" && args[0] === COMMIT)
        ttlArgs.push(args[11] ?? "");

      return send(command, args);
    };

    await store.createExecution("exec-frac", baseMeta(name));
    await commitFailed(store, "exec-frac", { ttlMs: 1500.5 });

    expect(ttlArgs).toEqual(["1501"]);
  });

  test("resumeExecution resumes failed then rejects non-failed status", async () => {
    const redis = createRedis();
    const name = "store-resume";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-resume";
    const resumeEvents = [
      { type: "WorkflowResumed" as const, timestamp: 3 },
      {
        type: "StepScheduled" as const,
        stepId: "a0",
        stepName: "once",
        attempt: 1,
        timestamp: 3,
      },
    ];

    await createFailed(store, name, executionId);
    expect(await dueIds(redis, name)).toEqual([]);

    const resumed = await store.resumeExecution({
      executionId,
      historyLength: 2,
      events: resumeEvents,
    });

    expect(resumed).toBe(true);

    const meta = await store.getMeta(executionId);
    expect(meta?.status).toBe("pending");
    expect(meta?.error).toBe("");
    expect(meta?.failedAt).toBe("");
    expect(
      parse(await store.loadHistory(executionId)).map((e) => e.type),
    ).toEqual([
      "WorkflowStarted",
      "WorkflowFailed",
      "WorkflowResumed",
      "StepScheduled",
    ]);
    expect(await dueIds(redis, name)).toEqual([executionId]);

    const again = await store.resumeExecution({
      executionId,
      historyLength: 4,
      events: resumeEvents,
    });

    expect(again).toBe(false);
    expect(await store.loadHistory(executionId)).toHaveLength(4);
  });

  test("resumeExecution rejects when history grew since events were computed", async () => {
    const redis = createRedis();
    const name = "store-resume-stale";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-stale";

    await createFailed(store, name, executionId, { ttlMs: 60_000 });

    // Another caller resumes from the same read, the run compensates and
    // fails again: status is "failed" once more, but history moved on.
    expect(
      await store.resumeExecution({
        executionId,
        historyLength: 2,
        events: [{ type: "WorkflowResumed", timestamp: 3 }],
      }),
    ).toBe(true);
    await store.claimDue("again", 60_000);
    await store.commit({
      executionId,
      leaseToken: "again",
      events: [
        {
          type: "CompensationStarted",
          reason: "failed",
          error: "boom",
          stepIds: [],
          timestamp: 4,
        },
        { type: "WorkflowFailed", error: "boom", timestamp: 5 },
      ],
      fields: { status: "failed", error: "boom", failedAt: "5" },
      retention: { ttlMs: 60_000 },
    });

    const stale = await store.resumeExecution({
      executionId,
      historyLength: 2,
      events: [{ type: "WorkflowResumed", timestamp: 6 }],
    });

    expect(stale).toBe(false);
    expect((await store.getMeta(executionId))?.status).toBe("failed");
    expect(await store.loadHistory(executionId)).toHaveLength(5);
    expect(await redis.pttl(keys.meta(name, executionId))).toBeGreaterThan(0);
    expect(await dueIds(redis, name)).toEqual([]);
  });

  test("requestCancel flags pending/running executions and makes them due", async () => {
    const redis = createRedis();
    const name = "store-cancel";
    const store = new WorkflowStore(redis, name);

    await store.createExecution("exec-c", baseMeta(name));

    const first = await store.requestCancel("exec-c");
    const firstAt = (await store.getMeta("exec-c"))?.cancelRequestedAt;
    const second = await store.requestCancel("exec-c");

    expect(first?.accepted).toBe(true);
    expect(first?.status).toBe("pending");
    expect(second?.accepted).toBe(true);
    expect(firstAt).not.toBe("");
    expect((await store.getMeta("exec-c"))?.cancelRequestedAt).toBe(firstAt);
    expect(await dueIds(redis, name)).toEqual(["exec-c"]);
    expect(await store.loadHistory("exec-c")).toHaveLength(1);
    expect(await store.requestCancel("missing")).toBeNull();
  });

  test("requestCancel writes nothing on terminal or compensating executions", async () => {
    const redis = createRedis();
    const name = "store-cancel-closed";
    const store = new WorkflowStore(redis, name);

    await createFailed(store, name, "exec-failed");
    await store.createExecution("exec-comp", baseMeta(name));
    await store.claimDue("owner", 60_000);
    await store.commit({
      executionId: "exec-comp",
      leaseToken: "owner",
      fields: { status: "compensating" },
    });

    for (const [executionId, status] of [
      ["exec-failed", "failed"],
      ["exec-comp", "compensating"],
    ] as const) {
      const result = await store.requestCancel(executionId);

      expect(result?.accepted).toBe(false);
      expect(result?.status).toBe(status);
      expect((await store.getMeta(executionId))?.cancelRequestedAt).toBe("");
    }

    // exec-comp keeps its claimed visibility timeout; nothing became due.
    expect(await redis.zrangebyscore(keys.due(name), 0, Date.now())).toEqual(
      [],
    );
  });

  test("commit reports a cancel requested while the lease was held", async () => {
    const name = "store-commit-cancel";
    const store = new WorkflowStore(createRedis(), name);

    await store.createExecution("exec-1", baseMeta(name));
    await store.claimDue("owner", 60_000);

    const before = await store.commit({
      executionId: "exec-1",
      leaseToken: "owner",
      fields: { status: "running" },
    });

    await store.requestCancel("exec-1");

    const after = await store.commit({
      executionId: "exec-1",
      leaseToken: "owner",
      events: [{ type: "StepStarted", stepId: "a0", attempt: 1, timestamp: 2 }],
    });
    const fenced = await store.commit({
      executionId: "exec-1",
      leaseToken: "intruder",
      events: [{ type: "StepStarted", stepId: "a1", attempt: 1, timestamp: 3 }],
    });

    expect(before).toEqual({ committed: true, cancelRequested: false });
    expect(after).toEqual({ committed: true, cancelRequested: true });
    expect(fenced).toEqual({ committed: false });
  });

  test("resumeExecution clears a cancel request that landed before the failure", async () => {
    const name = "store-resume-cancel";
    const store = new WorkflowStore(createRedis(), name);

    await store.createExecution("exec-1", baseMeta(name));
    await store.requestCancel("exec-1");
    await commitFailed(store, "exec-1");

    expect((await store.getMeta("exec-1"))?.cancelRequestedAt).not.toBe("");

    await store.resumeExecution({
      executionId: "exec-1",
      historyLength: 2,
      events: [{ type: "WorkflowResumed", timestamp: 3 }],
    });

    expect((await store.getMeta("exec-1"))?.cancelRequestedAt).toBe("");
  });

  test("getMeta returns null when the execution is missing", async () => {
    const store = new WorkflowStore(createRedis(), "store-missing");

    expect(await store.getMeta("missing")).toBeNull();
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

  test("resumeExecution persists retained keys and leaves the terminal zset", async () => {
    const redis = createRedis();
    const name = "store-persist";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-persist";

    await createFailed(store, name, executionId, {
      ttlMs: 60_000,
      trackedAt: 2,
    });

    expect(await redis.pttl(keys.meta(name, executionId))).toBeGreaterThan(0);

    await store.resumeExecution({
      executionId,
      historyLength: 2,
      events: [{ type: "WorkflowResumed", timestamp: 3 }],
    });

    expect(await redis.pttl(keys.meta(name, executionId))).toBe(-1);
    expect(await redis.pttl(keys.history(name, executionId))).toBe(-1);
    expect(await redis.send("ZCARD", [keys.terminal(name)])).toBe(0);
  });

  test("terminal commit without ttl keeps keys and leaves the due set", async () => {
    const redis = createRedis();
    const name = "store-retain-none";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-keep";

    await store.createExecution(executionId, baseMeta(name));
    await commitFailed(store, executionId, { trackedAt: 1 });

    expect(await redis.pttl(keys.meta(name, executionId))).toBe(-1);
    expect(await store.getMeta(executionId)).not.toBeNull();
    expect(await dueIds(redis, name)).toEqual([]);
  });

  test("trimTerminal unlinks oldest executions over max", async () => {
    const name = "store-trim";
    const store = new WorkflowStore(createRedis(), name);

    await createFailed(store, name, "old", { trackedAt: 1 });
    await createFailed(store, name, "mid", { trackedAt: 2 });
    await createFailed(store, name, "new", { trackedAt: 3 });
    await store.trimTerminal(2);

    expect(await store.getMeta("old")).toBeNull();
    expect(await store.loadHistory("old")).toEqual([]);
    expect(await store.getMeta("mid")).not.toBeNull();
    expect(await store.getMeta("new")).not.toBeNull();
  });

  test("terminal commit with ttl 0 unlinks keys so resume finds nothing", async () => {
    const redis = createRedis();
    const name = "store-retain-zero";
    const store = new WorkflowStore(redis, name);
    const executionId = "exec-gone";

    await store.createExecution(executionId, baseMeta(name));
    await store.claimDue("owner", 60_000);

    expect(
      await store.commit({
        executionId,
        leaseToken: "owner",
        events: [{ type: "WorkflowFailed", error: "boom", timestamp: 2 }],
        fields: { status: "failed", error: "boom", failedAt: "2" },
        retention: { ttlMs: 0 },
      }),
    ).toEqual({ committed: true, cancelRequested: false });

    expect(await store.getMeta(executionId)).toBeNull();
    expect(await store.loadHistory(executionId)).toEqual([]);
    expect(await store.getLease(executionId)).toBeNull();
    expect(await dueIds(redis, name)).toEqual([]);
    expect(
      await store.resumeExecution({
        executionId,
        historyLength: 0,
        events: [{ type: "WorkflowResumed", timestamp: 3 }],
      }),
    ).toBe(false);
    expect(await store.getMeta(executionId)).toBeNull();
  });

  test("trim cannot delete execution after resumeExecution removes terminal member", async () => {
    const name = "store-trim-race";
    const store = new WorkflowStore(createRedis(), name);

    await createFailed(store, name, "old", { trackedAt: 1 });
    await createFailed(store, name, "newer", { trackedAt: 2 });

    expect(
      await store.resumeExecution({
        executionId: "old",
        historyLength: 2,
        events: [{ type: "WorkflowResumed", timestamp: 3 }],
      }),
    ).toBe(true);
    await store.trimTerminal(1);

    expect((await store.getMeta("old"))?.status).toBe("pending");
    expect(await store.getMeta("newer")).not.toBeNull();
  });
});

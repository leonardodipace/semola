import {
  afterEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { mightThrow } from "../../errors/index.js";
import { CronDistributed } from "./index.js";

type SetCall = {
  key: string;
  value: string;
  args: string[];
};

class MockRedisClient {
  private strings = new Map<string, string>();
  private expiresAt = new Map<string, number>();
  public setCalls: SetCall[] = [];
  private shouldFail = false;
  private forcedReturn: string | null | undefined;

  public setShouldFail(value: boolean) {
    this.shouldFail = value;
  }

  public forceNextSetReturn(value: string | null) {
    this.forcedReturn = value;
  }

  private sweep(key: string) {
    const exp = this.expiresAt.get(key);

    if (exp === undefined) return false;
    if (Date.now() < exp) return false;

    this.strings.delete(key);
    this.expiresAt.delete(key);
    return true;
  }

  public async set(
    key: string,
    value: string,
    mode?: string,
    ttl?: string | number,
    flag?: string,
  ) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    const args = [mode, ttl, flag].filter((v) => v !== undefined).map(String);
    this.setCalls.push({ key, value, args });

    if (this.forcedReturn !== undefined) {
      const ret = this.forcedReturn;
      this.forcedReturn = undefined;
      return ret;
    }

    this.sweep(key);

    const nx = args.includes("NX");
    const pxIndex = args.indexOf("PX");

    let ttlMs: number | null = null;

    if (pxIndex >= 0) {
      ttlMs = Number(args[pxIndex + 1]);
    }

    if (nx) {
      if (this.strings.has(key)) return null;
    }

    this.strings.set(key, value);

    if (ttlMs !== null) {
      this.expiresAt.set(key, Date.now() + ttlMs);
    } else {
      this.expiresAt.delete(key);
    }

    return "OK";
  }

  public getLock(key: string) {
    this.sweep(key);

    return this.strings.get(key) ?? null;
  }

  public getLastSetCall() {
    return this.setCalls.at(-1) ?? null;
  }

  public clearSetCalls() {
    this.setCalls = [];
  }
}

const createMockRedis = () =>
  new MockRedisClient() as MockRedisClient & Bun.RedisClient;

const mockCronJob = {
  stop: () => {},
  ref: () => {},
  unref: () => {},
} as Bun.CronJob;

const mockInProcessCron = (handlers: Array<() => Promise<void>>) => {
  const parse = Bun.cron.parse;
  const remove = Bun.cron.remove;
  const cronSpy = spyOn(Bun, "cron").mockImplementation(((
    _schedule,
    handler,
  ) => {
    handlers.push(handler as () => Promise<void>);

    return mockCronJob;
  }) as typeof Bun.cron);

  Object.assign(Bun.cron, { parse, remove });

  return cronSpy;
};

const runTick = async (handler: (() => Promise<void>) | undefined) => {
  if (!handler) throw new Error("Expected cron handler to be registered");
  await handler();
};

const lockKeyTickMs = (key: string) => {
  const parts = key.split(":");
  return Number(parts.at(-1));
};

describe("CronDistributed", () => {
  afterEach(() => {
    setSystemTime();
  });

  test("should expose job name and resolved expression", () => {
    const job = new CronDistributed({
      name: "daily-report",
      schedule: "@daily",
      handler: () => Promise.resolve(),
      redis: createMockRedis(),
    });

    expect(job.getJobName()).toBe("daily-report");
    expect(job.getExpression()).toBe("0 0 * * *");
  });

  describe("multi-replica deduplication", () => {
    test("should run handler only once when three replicas fire the same tick", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 0, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const replicas = ["replica-a", "replica-b", "replica-c"].map(
        (replicaId) =>
          new CronDistributed({
            name: "triplicate",
            schedule: "@minutely",
            handler: () => {
              runs++;
              return Promise.resolve();
            },
            redis,
            replicaId,
          }),
      );

      for (const replica of replicas) {
        replica.run();
      }

      await Promise.all(handlers.map((handler) => handler()));

      expect(runs).toBe(1);

      cronSpy.mockRestore();
    });

    test("should deduplicate replicas that fire after the one-second lookback window", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 35, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const onTime = new CronDistributed({
        name: "delayed-dedup",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "on-time",
      });

      const delayed = new CronDistributed({
        name: "delayed-dedup",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "delayed",
      });

      onTime.run();
      delayed.run();

      await runTick(handlers[0]);
      setSystemTime(new Date(2027, 4, 8, 12, 35, 2));
      await runTick(handlers[1]);

      expect(runs).toBe(1);

      const firstKey = redis.setCalls[0]?.key;
      const secondKey = redis.setCalls[1]?.key;

      if (!firstKey || !secondKey) {
        throw new Error("Expected lock keys for both replicas");
      }

      expect(firstKey).toBe(secondKey);

      cronSpy.mockRestore();
    });
  });

  describe("job isolation", () => {
    test("should run both handlers when job names differ on the same tick", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 3, 0));

      const redis = createMockRedis();
      const runs = { alpha: 0, beta: 0 };
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const alpha = new CronDistributed({
        name: "alpha",
        schedule: "@minutely",
        handler: () => {
          runs.alpha++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-a",
      });

      const beta = new CronDistributed({
        name: "beta",
        schedule: "@minutely",
        handler: () => {
          runs.beta++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-b",
      });

      alpha.run();
      beta.run();

      await Promise.all(handlers.map((handler) => handler()));

      expect(runs.alpha).toBe(1);
      expect(runs.beta).toBe(1);

      cronSpy.mockRestore();
    });

    test("should not share locks between same name on different redis instances", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 5, 0));

      const redisA = createMockRedis();
      const redisB = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const jobA = new CronDistributed({
        name: "shared-name",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis: redisA,
        replicaId: "replica-a",
      });

      const jobB = new CronDistributed({
        name: "shared-name",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis: redisB,
        replicaId: "replica-b",
      });

      jobA.run();
      jobB.run();

      await Promise.all(handlers.map((handler) => handler()));

      expect(runs).toBe(2);

      cronSpy.mockRestore();
    });

    test("should not deduplicate same job name when schedules differ", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 6, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const hourly = new CronDistributed({
        name: "same-tick-name",
        schedule: "@hourly",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-a",
      });

      const minutely = new CronDistributed({
        name: "same-tick-name",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-b",
      });

      hourly.run();
      minutely.run();

      await runTick(handlers[0]);
      await runTick(handlers[1]);

      expect(runs).toBe(2);

      cronSpy.mockRestore();
    });
  });

  describe("tick advancement", () => {
    test("should run again on the next minute after time advances", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 10, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "minute-advance",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-a",
      });

      job.run();

      await runTick(handlers[0]);
      expect(runs).toBe(1);

      setSystemTime(new Date(2027, 4, 8, 12, 11, 0));
      await runTick(handlers[0]);
      expect(runs).toBe(2);

      cronSpy.mockRestore();
    });
  });

  describe("lock TTL", () => {
    test("should allow re-acquisition after lock TTL expires", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 20, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "ttl-expiry",
        schedule: "@minutely",
        lockTTL: 50,
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-a",
      });

      job.run();

      await runTick(handlers[0]);
      expect(runs).toBe(1);

      setSystemTime(new Date(2027, 4, 8, 12, 20, 0, 100));
      await runTick(handlers[0]);
      expect(runs).toBe(2);

      cronSpy.mockRestore();
    });

    test("should allow a delayed replica to run the same tick after lock TTL expires", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 22, 2));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const leader = new CronDistributed({
        name: "ttl-delayed-replica",
        schedule: "@minutely",
        lockTTL: 50,
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "leader",
      });

      const delayed = new CronDistributed({
        name: "ttl-delayed-replica",
        schedule: "@minutely",
        lockTTL: 50,
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "delayed",
      });

      leader.run();
      delayed.run();

      await runTick(handlers[0]);
      expect(runs).toBe(1);

      setSystemTime(new Date(2027, 4, 8, 12, 22, 2, 100));
      await runTick(handlers[1]);
      expect(runs).toBe(2);

      const firstKey = redis.setCalls[0]?.key;
      const secondKey = redis.setCalls[1]?.key;

      if (!firstKey || !secondKey) {
        throw new Error("Expected lock keys for both replicas");
      }

      expect(firstKey).toBe(secondKey);

      cronSpy.mockRestore();
    });
  });

  describe("replica identity", () => {
    test("should store provided replicaId as the lock value", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 30, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "replica-id",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "pod-7",
      });

      job.run();
      await runTick(handlers[0]);

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");

      expect(call.value).toBe("pod-7");
      expect(redis.getLock(call.key)).toBe("pod-7");

      cronSpy.mockRestore();
    });
  });

  describe("error propagation", () => {
    test("should propagate redis SET failures", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 42, 0));

      const redis = createMockRedis();
      redis.setShouldFail(true);
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "redis-error",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      job.run();

      const [error] = await mightThrow(runTick(handlers[0]));

      if (!error) throw new Error("Expected redis SET to throw");
      expect(error.message).toBe("Redis connection error");

      cronSpy.mockRestore();
    });
  });

  describe("lifecycle", () => {
    test("should transition idle to running to idle", () => {
      const job = new CronDistributed({
        name: "lifecycle",
        schedule: "@hourly",
        handler: () => Promise.resolve(),
        redis: createMockRedis(),
      });

      expect(job.getStatus()).toBe("idle");

      job.run();
      expect(job.getStatus()).toBe("running");

      job.stop();
      expect(job.getStatus()).toBe("idle");
    });
  });

  describe("concurrent invocations", () => {
    test("should run handler only once when the same replica fires twice concurrently", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 50, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "concurrent-same-replica",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-a",
      });

      job.run();

      const handler = handlers[0];
      if (!handler) throw new Error("Expected cron handler to be registered");

      await Promise.all([handler(), handler()]);

      expect(runs).toBe(1);

      cronSpy.mockRestore();
    });
  });

  describe("lock key format", () => {
    test("should use cron:{name}:{expr}:{tickMs} lock keys with SET NX PX", async () => {
      setSystemTime(new Date(2027, 4, 8, 13, 0, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "lock-format",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      job.run();
      await runTick(handlers[0]);

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");

      expect(call.key.startsWith("cron:lock-format:* * * * *:")).toBe(true);
      expect(Number.isFinite(lockKeyTickMs(call.key))).toBe(true);
      expect(call.args).toContain("NX");
      expect(call.args).toContain("PX");

      cronSpy.mockRestore();
    });

    test("should use different lock keys across minute boundaries", async () => {
      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "minute-boundary",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      job.run();

      setSystemTime(new Date(2027, 4, 8, 12, 58, 0));
      await runTick(handlers[0]);
      const firstKey = redis.getLastSetCall()?.key;

      setSystemTime(new Date(2027, 4, 8, 12, 59, 0));
      await runTick(handlers[0]);
      const secondKey = redis.getLastSetCall()?.key;

      if (!firstKey || !secondKey) {
        throw new Error("Expected lock keys for both ticks");
      }

      expect(firstKey).not.toBe(secondKey);
      expect(lockKeyTickMs(firstKey)).not.toBe(lockKeyTickMs(secondKey));

      cronSpy.mockRestore();
    });

    test("should embed resolved expression for raw cron in lock key", async () => {
      setSystemTime(new Date(2027, 4, 5, 4, 30, 2));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "expr-raw",
        schedule: "30 4 * * 3",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      const expr = job.getExpression();
      job.run();
      await runTick(handlers[0]);

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");

      expect(call.key).toBe(`cron:expr-raw:${expr}:${lockKeyTickMs(call.key)}`);

      cronSpy.mockRestore();
    });
  });

  describe("long-interval schedules", () => {
    test("should deduplicate @monthly replicas when slack fallback resolves the tick", async () => {
      setSystemTime(new Date(2027, 4, 1, 0, 0, 2));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const replicas = ["replica-a", "replica-b"].map(
        (replicaId) =>
          new CronDistributed({
            name: "monthly-slack",
            schedule: "@monthly",
            handler: () => {
              runs++;
              return Promise.resolve();
            },
            redis,
            replicaId,
          }),
      );

      for (const replica of replicas) {
        replica.run();
      }

      await Promise.all(handlers.map((handler) => handler()));

      expect(runs).toBe(1);

      const firstKey = redis.setCalls[0]?.key;
      const secondKey = redis.setCalls[1]?.key;

      if (!firstKey || !secondKey) {
        throw new Error("Expected lock keys for both replicas");
      }

      expect(firstKey).toBe(secondKey);
      expect(firstKey.startsWith("cron:monthly-slack:0 0 1 * *:")).toBe(true);

      cronSpy.mockRestore();
    });

    test("should use different lock keys for @yearly ticks in different years", async () => {
      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "yearly-lock",
        schedule: "@yearly",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      job.run();

      setSystemTime(new Date(2027, 0, 1, 0, 0, 0));
      await runTick(handlers[0]);
      const firstKey = redis.getLastSetCall()?.key;

      setSystemTime(new Date(2028, 0, 1, 0, 0, 0));
      await runTick(handlers[0]);
      const secondKey = redis.getLastSetCall()?.key;

      if (!firstKey || !secondKey) {
        throw new Error("Expected lock keys for both yearly ticks");
      }

      expect(firstKey).not.toBe(secondKey);

      cronSpy.mockRestore();
    });
  });

  describe("lock TTL edge cases", () => {
    test("should not renew lock while handler exceeds lockTTL", async () => {
      setSystemTime(new Date(2027, 4, 8, 14, 22, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const leader = new CronDistributed({
        name: "slow-handler",
        schedule: "@minutely",
        lockTTL: 30,
        handler: async () => {
          runs++;
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
        redis,
        replicaId: "leader",
      });

      const follower = new CronDistributed({
        name: "slow-handler",
        schedule: "@minutely",
        lockTTL: 30,
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "follower",
      });

      leader.run();
      follower.run();

      const leaderTick = runTick(handlers[0]);
      await Promise.resolve();
      setSystemTime(new Date(2027, 4, 8, 14, 22, 0, 40));
      await runTick(handlers[1]);
      await leaderTick;

      expect(runs).toBe(2);

      cronSpy.mockRestore();
    });

    test("should block second replica while lockTTL covers handler duration", async () => {
      setSystemTime(new Date(2027, 4, 8, 14, 23, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const slow = new CronDistributed({
        name: "exact-ttl",
        schedule: "@minutely",
        lockTTL: 100,
        handler: async () => {
          runs++;
          await new Promise((resolve) => setTimeout(resolve, 80));
        },
        redis,
        replicaId: "slow",
      });

      const fast = new CronDistributed({
        name: "exact-ttl",
        schedule: "@minutely",
        lockTTL: 100,
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "fast",
      });

      slow.run();
      fast.run();

      const slowTick = runTick(handlers[0]);
      await Promise.resolve();
      setSystemTime(new Date(2027, 4, 8, 14, 23, 0, 50));
      await runTick(handlers[1]);
      await slowTick;

      expect(runs).toBe(1);

      cronSpy.mockRestore();
    });

    test("should allow another replica after lockTTL when handler never resolves", async () => {
      setSystemTime(new Date(2027, 4, 8, 15, 12, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const hangForever = new Promise<void>(() => {});

      const leader = new CronDistributed({
        name: "ttl-hang",
        schedule: "@minutely",
        lockTTL: 50,
        handler: () => {
          runs++;
          return hangForever;
        },
        redis,
        replicaId: "leader",
      });

      const follower = new CronDistributed({
        name: "ttl-hang",
        schedule: "@minutely",
        lockTTL: 50,
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "follower",
      });

      leader.run();
      follower.run();

      void runTick(handlers[0]);
      await Promise.resolve();
      setSystemTime(new Date(2027, 4, 8, 15, 12, 0, 60));
      await runTick(handlers[1]);

      expect(runs).toBe(2);

      cronSpy.mockRestore();
    });

    test("should acquire lock before starting a hanging handler", async () => {
      setSystemTime(new Date(2027, 4, 8, 15, 11, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      let lockKeyDuringHandler: string | null = null;

      const job = new CronDistributed({
        name: "lock-before-hang",
        schedule: "@minutely",
        handler: () => {
          const call = redis.getLastSetCall();
          lockKeyDuringHandler = call?.key ?? null;
          return new Promise<void>(() => {});
        },
        redis,
        replicaId: "replica-a",
      });

      job.run();

      void runTick(handlers[0]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lockKeyDuringHandler).not.toBeNull();

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");
      expect(redis.getLock(call.key)).toBe("replica-a");

      cronSpy.mockRestore();
    });
  });

  describe("duplicate replicaId across instances", () => {
    test("should deduplicate two replicas sharing the same replicaId via NX", async () => {
      setSystemTime(new Date(2027, 4, 8, 14, 30, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      for (const _replica of [1, 2]) {
        new CronDistributed({
          name: "shared-replica-id",
          schedule: "@minutely",
          handler: () => {
            runs++;
            return Promise.resolve();
          },
          redis,
          replicaId: "same-pod",
        }).run();
      }

      await Promise.all(handlers.map((handler) => handler()));

      expect(runs).toBe(1);

      cronSpy.mockRestore();
    });
  });

  describe("sequential ticks", () => {
    test("should deduplicate replicas on each of two sequential ticks independently", async () => {
      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      for (const replicaId of ["t-a", "t-b"]) {
        new CronDistributed({
          name: "seq-dedup",
          schedule: "@minutely",
          handler: () => {
            runs++;
            return Promise.resolve();
          },
          redis,
          replicaId,
        }).run();
      }

      setSystemTime(new Date(2027, 4, 8, 16, 20, 0));
      await Promise.all(handlers.map((handler) => handler()));
      expect(runs).toBe(1);

      runs = 0;
      redis.clearSetCalls();

      setSystemTime(new Date(2027, 4, 8, 16, 21, 0));
      await Promise.all(handlers.map((handler) => handler()));
      expect(runs).toBe(1);

      cronSpy.mockRestore();
    });
  });

  describe("job name edge cases", () => {
    test("should include colons in job name within lock key", async () => {
      setSystemTime(new Date(2027, 4, 8, 16, 50, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "team:service:job",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      expect(job.getJobName()).toBe("team:service:job");

      job.run();
      await runTick(handlers[0]);

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");

      expect(call.key.startsWith("cron:team:service:job:")).toBe(true);

      cronSpy.mockRestore();
    });
  });

  describe("redis non-OK responses", () => {
    test("should skip handler when redis SET returns null without throwing", async () => {
      setSystemTime(new Date(2027, 4, 8, 17, 0, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const winner = new CronDistributed({
        name: "redis-null",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "winner",
      });

      const loser = new CronDistributed({
        name: "redis-null",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "loser",
      });

      winner.run();
      loser.run();

      await runTick(handlers[0]);
      redis.forceNextSetReturn(null);
      await runTick(handlers[1]);

      expect(runs).toBe(1);

      cronSpy.mockRestore();
    });
  });

  describe("concurrent multi-job ticks", () => {
    test("should deduplicate per job independently during concurrent multi-job ticks", async () => {
      setSystemTime(new Date(2027, 4, 8, 17, 10, 0));

      const redis = createMockRedis();
      const alphaRuns = { count: 0 };
      const betaRuns = { count: 0 };
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      for (const replicaId of ["a1", "a2"]) {
        new CronDistributed({
          name: "alpha",
          schedule: "@minutely",
          handler: () => {
            alphaRuns.count++;
            return Promise.resolve();
          },
          redis,
          replicaId,
        }).run();
      }

      for (const replicaId of ["b1", "b2"]) {
        new CronDistributed({
          name: "beta",
          schedule: "@minutely",
          handler: () => {
            betaRuns.count++;
            return Promise.resolve();
          },
          redis,
          replicaId,
        }).run();
      }

      await Promise.all(handlers.map((handler) => handler()));

      expect(alphaRuns.count).toBe(1);
      expect(betaRuns.count).toBe(1);

      cronSpy.mockRestore();
    });
  });
});

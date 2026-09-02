import { describe, expect, setSystemTime, spyOn, test } from "bun:test";
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

  public setShouldFail(value: boolean) {
    this.shouldFail = value;
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

describe("CronDistributed adversarial", () => {
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

    test("should run all three differently named jobs on the same tick", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 4, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      for (const name of ["job-a", "job-b", "job-c"]) {
        const job = new CronDistributed({
          name,
          schedule: "@minutely",
          handler: () => {
            runs++;
            return Promise.resolve();
          },
          redis,
          replicaId: "replica-1",
        });

        job.run();
      }

      await Promise.all(handlers.map((handler) => handler()));

      expect(runs).toBe(3);

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

    test("should allow same job name with different schedules when tick times differ", async () => {
      const redis = createMockRedis();
      let hourlyRuns = 0;
      let minutelyRuns = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const hourly = new CronDistributed({
        name: "mixed-schedule",
        schedule: "@hourly",
        handler: () => {
          hourlyRuns++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-a",
      });

      const minutely = new CronDistributed({
        name: "mixed-schedule",
        schedule: "@minutely",
        handler: () => {
          minutelyRuns++;
          return Promise.resolve();
        },
        redis,
        replicaId: "replica-b",
      });

      hourly.run();
      minutely.run();

      setSystemTime(new Date(2027, 4, 8, 12, 0, 0));
      await runTick(handlers[0]);
      expect(hourlyRuns).toBe(1);

      setSystemTime(new Date(2027, 4, 8, 12, 5, 0));
      await runTick(handlers[1]);
      expect(minutelyRuns).toBe(1);

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

    test("should pass custom lockTTL to redis SET PX", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 21, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "custom-ttl",
        schedule: "@minutely",
        lockTTL: 600_000,
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      job.run();
      await runTick(handlers[0]);

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");

      expect(call.args).toContain("PX");
      expect(call.args).toContain("600000");

      cronSpy.mockRestore();
    });

    test("should default lockTTL to 300000ms when omitted", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 22, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "default-ttl",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
        redis,
        replicaId: "replica-a",
      });

      job.run();
      await runTick(handlers[0]);

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");

      expect(call.args).toContain("PX");
      expect(call.args).toContain("300000");

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

    test("should generate a non-empty replicaId when omitted", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 32, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "generated-replica",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
        redis,
      });

      job.run();
      await runTick(handlers[0]);

      const call = redis.getLastSetCall();
      if (!call) throw new Error("Expected redis SET call");

      expect(call.value.length).toBeGreaterThan(0);

      cronSpy.mockRestore();
    });
  });

  describe("error propagation", () => {
    test("should propagate synchronous handler errors", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 40, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "sync-error",
        schedule: "@minutely",
        handler: () => {
          throw new Error("sync boom");
        },
        redis,
        replicaId: "replica-a",
      });

      job.run();

      await expect(runTick(handlers[0])).rejects.toThrow("sync boom");

      cronSpy.mockRestore();
    });

    test("should propagate async handler rejections", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 41, 0));

      const redis = createMockRedis();
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const job = new CronDistributed({
        name: "async-error",
        schedule: "@minutely",
        handler: () => Promise.reject(new Error("async boom")),
        redis,
        replicaId: "replica-a",
      });

      job.run();

      await expect(runTick(handlers[0])).rejects.toThrow("async boom");

      cronSpy.mockRestore();
    });

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

      await expect(runTick(handlers[0])).rejects.toThrow(
        "Redis connection error",
      );

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

  describe("ref and unref", () => {
    test("should delegate ref() to the underlying cron job", () => {
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);
      const refSpy = spyOn(mockCronJob, "ref");

      const job = new CronDistributed({
        name: "ref-test",
        schedule: "@hourly",
        handler: () => Promise.resolve(),
        redis: createMockRedis(),
      });

      job.run();
      job.ref();

      expect(refSpy).toHaveBeenCalledTimes(1);

      refSpy.mockRestore();
      cronSpy.mockRestore();
    });

    test("should delegate unref() to the underlying cron job", () => {
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);
      const unrefSpy = spyOn(mockCronJob, "unref");

      const job = new CronDistributed({
        name: "unref-test",
        schedule: "@hourly",
        handler: () => Promise.resolve(),
        redis: createMockRedis(),
      });

      job.run();
      job.unref();

      expect(unrefSpy).toHaveBeenCalledTimes(1);

      unrefSpy.mockRestore();
      cronSpy.mockRestore();
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

    test("should skip silently when lock is not acquired", async () => {
      setSystemTime(new Date(2027, 4, 8, 12, 52, 0));

      const redis = createMockRedis();
      let runs = 0;
      const handlers: Array<() => Promise<void>> = [];
      const cronSpy = mockInProcessCron(handlers);

      const winner = new CronDistributed({
        name: "silent-skip",
        schedule: "@minutely",
        handler: () => {
          runs++;
          return Promise.resolve();
        },
        redis,
        replicaId: "winner",
      });

      const loser = new CronDistributed({
        name: "silent-skip",
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

      await expect(
        Promise.all(handlers.map((handler) => handler())),
      ).resolves.toBeDefined();

      expect(runs).toBe(1);

      cronSpy.mockRestore();
    });
  });

  describe("lock key format", () => {
    test("should use cron:{name}:{tickMs} lock keys with SET NX PX", async () => {
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

      expect(call.key.startsWith("cron:lock-format:")).toBe(true);
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
  });

  describe("long-interval schedules", () => {
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
});

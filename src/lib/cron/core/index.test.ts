import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { mightThrowSync } from "../../errors/index.js";
import { Cron, CronOS } from "./index.js";
import { parseExpression } from "./schedule.js";

// setTimeout treats anything above a signed 32-bit int as 1ms.
const MAX_SET_TIMEOUT_MS = 2_147_483_647;

const createDeferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const flushPromises = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe("Cron", () => {
  describe("constructor", () => {
    test("should create a cron job with standard expression", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "test-job",
        schedule: "0 0 * * *",
        handler,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should create a cron job with @daily alias", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "daily-job",
        schedule: "@daily",
        handler,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should create a cron job with @hourly alias", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "hourly-job",
        schedule: "@hourly",
        handler,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should throw an error for invalid cron expression", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "invalid",
          handler,
        }).run();
      }).toThrow(TypeError);
    });

    test("should throw an error for cron expression with wrong field count", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "0 0 * *",
          handler,
        }).run();
      }).toThrow(TypeError);
    });

    test("should throw an error when passing an invalid expression", () => {
      const handler = () => Promise.resolve();
      const cron = new Cron({
        name: "invalid-job",
        schedule: "0 0 * *",
        handler,
      });

      const [scheduleFormatError] = mightThrowSync(() => cron.run());
      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");
      expect(scheduleFormatError).toBeDefined();
    });

    test("should throw an error when passing an invalid alias", () => {
      const handler = () => Promise.resolve();
      const cron = new Cron({
        name: "invalid-alias",
        schedule: "@invalid-alias",
        handler,
      });

      const [invalidAliasError] = mightThrowSync(() => cron.run());
      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");
      expect(invalidAliasError).toBeDefined();
    });
  });

  describe("lifecycle methods", () => {
    test("should start and stop a cron job", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "lifecycle-test",
        schedule: "0 0 * * *",
        handler,
      });

      expect(cron.getStatus()).toBe("idle");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should not stop if not running", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "pause-idle-test",
        schedule: "0 0 * * *",
        handler,
      });

      expect(cron.getStatus()).toBe("idle");
      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should handle multiple start calls gracefully without creating multiple jobs", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "multi-start",
        schedule: "0 0 * * *",
        handler,
      });

      cron.run();
      expect(cron.getStatus()).toBe("running");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });
  });

  describe("scheduling", () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date(2026, 10, 8, 12, 0, 30) });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("should fire the handler at every matching minute", async () => {
      let calls = 0;
      const cron = new Cron({
        name: "every-minute",
        schedule: "* * * * *",
        handler: () => {
          calls++;
        },
      });

      cron.run();

      jest.advanceTimersByTime(29_999);
      await flushPromises();
      expect(calls).toBe(0);

      jest.advanceTimersByTime(1);
      await flushPromises();
      expect(calls).toBe(1);

      jest.advanceTimersByTime(60_000);
      await flushPromises();
      expect(calls).toBe(2);

      cron.stop();
    });

    test("should not fire again after stop", async () => {
      let calls = 0;
      const cron = new Cron({
        name: "stopped",
        schedule: "* * * * *",
        handler: () => {
          calls++;
        },
      });

      cron.run();
      cron.stop();

      jest.advanceTimersByTime(180_000);
      await flushPromises();

      expect(calls).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("should not start the next run until a slow handler settles", async () => {
      const gate = createDeferred();
      let calls = 0;
      const cron = new Cron({
        name: "slow",
        schedule: "* * * * *",
        handler: () => {
          calls++;

          return gate.promise;
        },
      });

      cron.run();

      // Handler starts at 12:01:00 and is still running at 12:03:30.
      jest.advanceTimersByTime(30_000);
      jest.advanceTimersByTime(150_000);
      await flushPromises();
      expect(calls).toBe(1);

      gate.resolve();
      await flushPromises();

      // Overrun boundaries are skipped: the next run is 12:04:00.
      jest.advanceTimersByTime(29_999);
      await flushPromises();
      expect(calls).toBe(1);

      jest.advanceTimersByTime(1);
      await flushPromises();
      expect(calls).toBe(2);

      cron.stop();
    });

    test("should not reschedule when stopped while the handler runs", async () => {
      const gate = createDeferred();
      const cron = new Cron({
        name: "stop-in-flight",
        schedule: "* * * * *",
        handler: () => gate.promise,
      });

      cron.run();
      jest.advanceTimersByTime(30_000);
      cron.stop();

      gate.resolve();
      await flushPromises();

      expect(cron.getStatus()).toBe("idle");
      expect(jest.getTimerCount()).toBe(0);
    });

    test("should keep a single timer when restarted while the handler runs", async () => {
      const gate = createDeferred();
      const cron = new Cron({
        name: "restart-in-flight",
        schedule: "* * * * *",
        handler: () => gate.promise,
      });

      cron.run();
      jest.advanceTimersByTime(30_000);
      cron.stop();
      cron.run();

      gate.resolve();
      await flushPromises();

      expect(jest.getTimerCount()).toBe(1);

      cron.stop();
    });

    test("should rethrow a handler error and keep running", async () => {
      const cron = new Cron({
        name: "failing",
        schedule: "* * * * *",
        handler: () => {
          throw new Error("boom");
        },
      });

      const fields = parseExpression("* * * * *");
      // biome-ignore lint/complexity/useLiteralKeys: wake and runId are private
      const fire = cron["wake"](fields, new Date(0), cron["runId"]);

      await expect(fire).rejects.toThrow("boom");
      // The next run was armed before the error was rethrown.
      expect(jest.getTimerCount()).toBe(1);
    });

    test("should wait again when the timer fires before the boundary", async () => {
      let calls = 0;
      const cron = new Cron({
        name: "early-timer",
        schedule: "* * * * *",
        handler: () => {
          calls++;
        },
      });

      cron.run();

      const fields = parseExpression("* * * * *");
      const early = new Date(Date.now() + 5);
      // biome-ignore lint/complexity/useLiteralKeys: wake and runId are private
      await cron["wake"](fields, early, cron["runId"]);

      expect(calls).toBe(0);

      jest.advanceTimersByTime(5);
      await flushPromises();
      expect(calls).toBe(1);

      cron.stop();
    });

    test("should wait out delays longer than a single timer allows", async () => {
      let calls = 0;
      const cron = new Cron({
        name: "yearly-wait",
        schedule: "@yearly",
        handler: () => {
          calls++;
        },
      });

      cron.run();

      jest.advanceTimersByTime(MAX_SET_TIMEOUT_MS);
      await flushPromises();
      expect(calls).toBe(0);
      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(new Date(2027, 0, 1).getTime() - Date.now());
      await flushPromises();
      expect(calls).toBe(1);

      cron.stop();
    });

    test("should throw on run when the schedule never matches", () => {
      const cron = new Cron({
        name: "never",
        schedule: "0 0 31 2 *",
        handler: () => {},
      });

      expect(() => cron.run()).toThrow(TypeError);
      expect(cron.getStatus()).toBe("idle");
    });
  });

  describe("aliases", () => {
    test("should support @yearly and @annually alias", () => {
      const yearly = new Cron({
        name: "yearly",
        schedule: "@yearly",
        handler: () => Promise.resolve(),
      });

      const annually = new Cron({
        name: "yearly",
        schedule: "@annually",
        handler: () => Promise.resolve(),
      });

      expect(() => yearly.run()).not.toThrow();
      expect(() => annually.run()).not.toThrow();

      yearly.stop();
      annually.stop();
    });

    test("should support @monthly alias", () => {
      const monthly = new Cron({
        name: "monthly",
        schedule: "@monthly",
        handler: () => Promise.resolve(),
      });

      expect(() => monthly.run()).not.toThrow();
      monthly.stop();
    });

    test("should support @weekly alias", () => {
      const weekly = new Cron({
        name: "weekly",
        schedule: "@weekly",
        handler: () => Promise.resolve(),
      });

      expect(() => weekly.run()).not.toThrow();
      weekly.stop();
    });

    test("should support @daily and @midnight alias", () => {
      const daily = new Cron({
        name: "daily",
        schedule: "@daily",
        handler: () => Promise.resolve(),
      });

      const midnight = new Cron({
        name: "midnight",
        schedule: "@midnight",
        handler: () => Promise.resolve(),
      });

      expect(() => daily.run()).not.toThrow();
      expect(() => midnight.run()).not.toThrow();

      daily.stop();
      midnight.stop();
    });

    test("should support @hourly alias", () => {
      const hourly = new Cron({
        name: "hourly",
        schedule: "@hourly",
        handler: () => Promise.resolve(),
      });

      expect(() => hourly.run()).not.toThrow();
      hourly.stop();
    });

    test("should read aliases regardless of case and padding", () => {
      const cron = new Cron({
        name: "padded",
        schedule: " @Daily ",
        handler: () => Promise.resolve(),
      });

      expect(cron.getExpression()).toBe("0 0 * * *");
      expect(() => cron.run()).not.toThrow();

      cron.stop();
    });

    test("should support @minutely alias", () => {
      const minutely = new Cron({
        name: "minutely",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
      });

      expect(() => minutely.run()).not.toThrow();
      minutely.stop();
    });
  });

  describe("next() search horizon", () => {
    test("should find next run for yearly schedule", () => {
      setSystemTime();

      const cron = new Cron({
        name: "yearly-horizon",
        schedule: "@yearly",
        handler: () => Promise.resolve(),
      });

      const next = cron.next();
      if (!next) throw new Error("Expected next run to be found");

      expect(next.getFullYear()).toBe(new Date().getFullYear() + 1);
      expect(next.getMonth()).toBe(0);
      expect(next.getDate()).toBe(1);
      expect(next.getHours()).toBe(0);
      expect(next.getMinutes()).toBe(0);
    });

    test("should find next run for specific month and day", () => {
      // Dec 25 - always within 366 days
      const cron = new Cron({
        name: "dec25",
        schedule: "0 12 25 12 *",
        handler: () => Promise.resolve(),
      });

      const next = cron.next();
      if (!next) throw new Error("Expected next run to be found");

      expect(next.getMonth()).toBe(11);
      expect(next.getDate()).toBe(25);
      expect(next.getHours()).toBe(12);
    });

    test("should find next run for leap day schedule beyond 366 days", () => {
      // "0 0 29 2 *" = midnight on Feb 29 (leap day)
      // Next Feb 29 from 2026-03-01 is 2028-02-29 (~730 days away)
      const cron = new Cron({
        name: "leap-day",
        schedule: "0 0 29 2 *",
        handler: () => Promise.resolve(),
      });

      const next = cron.next();
      expect(next).not.toBeNull();
    });

    test("should find next run when using a past starting date", () => {
      const cron = new Cron({
        name: "daily-horizon-from-the-past",
        schedule: "@daily",
        handler: () => Promise.resolve(),
      });

      const next = cron.next(new Date(2026, 4, 8));
      if (!next) throw new Error("Expected next run to be found");

      expect(next.getFullYear()).toBe(2026);
      expect(next.getMonth()).toBe(4);
      expect(next.getDate()).toBe(9);
    });

    test("should find next run when using a future starting date", () => {
      const cron = new Cron({
        name: "daily-horizon-from-the-future",
        schedule: "@daily",
        handler: () => Promise.resolve(),
      });

      const next = cron.next(new Date(2027, 4, 8));
      if (!next) throw new Error("Expected next run to be found");

      expect(next.getFullYear()).toBe(2027);
      expect(next.getMonth()).toBe(4);
      expect(next.getDate()).toBe(9);
    });

    test("should find next run when using the @minutely alias", () => {
      const cron = new Cron({
        name: "minutely-horizon",
        schedule: "@minutely",
        handler: () => Promise.resolve(),
      });

      const next = cron.next(new Date(2027, 4, 8, 0, 16, 0));
      if (!next) throw new Error("Expected next run to be found");

      expect(next.getFullYear()).toBe(2027);
      expect(next.getMonth()).toBe(4);
      expect(next.getDate()).toBe(8);
      expect(next.getHours()).toBe(0);
      expect(next.getMinutes()).toBe(17);
    });

    test("should return null when no match is found", () => {
      const cron = new Cron({
        name: "leap-day",
        schedule: "0 0 31 2 *",
        handler: () => Promise.resolve(),
      });

      const next = cron.next();
      expect(next).toBeNull();
    });

    test("should raise a TypeError when starting date an invalid number", () => {
      const cron = new Cron({
        name: "leap-day",
        schedule: "0 0 2 2 *",
        handler: () => Promise.resolve(),
      });

      expect(() => cron.next(NaN)).toThrow(TypeError);
      expect(() => cron.next(Infinity)).toThrow(TypeError);
      expect(() => cron.next(-Infinity)).toThrow(TypeError);
    });

    test("should raise an error when the received starting date is invalid", () => {
      const cron = new Cron({
        name: "on-error-call",
        schedule: "0 0 18 2 *",
        handler: () => Promise.resolve(),
      });

      const [nanError, nanDate] = mightThrowSync(() => cron.next(NaN));
      const [infinityError, infinityDate] = mightThrowSync(() =>
        cron.next(Infinity),
      );
      const [negativeInfinityError, negativeInfinityDate] = mightThrowSync(() =>
        cron.next(-Infinity),
      );

      expect(nanDate).toBeNull();
      expect(infinityDate).toBeNull();
      expect(negativeInfinityDate).toBeNull();

      expect(nanError).toBeDefined();
      expect(infinityError).toBeDefined();
      expect(negativeInfinityError).toBeDefined();
    });
  });

  describe("state transitions", () => {
    test("should maintain status correctly through transitions", () => {
      const cron = new Cron({
        name: "state-test",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
      });

      expect(cron.getStatus()).toBe("idle");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });
  });

  describe("Dispose API", () => {
    test("should stop a job automatically", () => {
      const job = new Cron({
        name: "disposable",
        schedule: "@minutely",
        handler: async () => Promise.resolve(),
      });

      const stopSpy = spyOn(job, "stop");

      {
        using scoped = job;
        scoped.run();
      }

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(job.getStatus()).toBe("idle");
    });
  });
});

describe("CronOS", () => {
  test("should expose job name and resolved expression", () => {
    const job = new CronOS({
      name: "daily-report",
      schedule: "@daily",
      path: "./report-worker.ts",
    });

    expect(job.getJobName()).toBe("daily-report");
    expect(job.getExpression()).toBe("0 0 * * *");
  });

  test("should compute the next run", () => {
    const job = new CronOS({
      name: "monthly-job",
      schedule: "@monthly",
      path: "./worker.ts",
    });

    const next = job.next(new Date(2020, 0, 10));
    if (!next) throw new Error("Expected next run to be found");

    expect(next).toEqual(new Date("2020-02-01T00:00:00.000Z"));
  });

  test("run should register an OS-level cron job", async () => {
    const cronSpy = spyOn(Bun, "cron").mockResolvedValue(undefined);

    const job = new CronOS({
      name: "os-job",
      schedule: "@daily",
      path: "./worker.ts",
    });

    await job.run();

    expect(cronSpy).toHaveBeenCalledWith("./worker.ts", "0 0 * * *", "os-job");

    cronSpy.mockRestore();
  });

  test("stop should remove the OS-level cron job", async () => {
    const removeSpy = spyOn(Bun.cron, "remove").mockResolvedValue(undefined);

    const job = new CronOS({
      name: "os-job",
      schedule: "@daily",
      path: "./worker.ts",
    });

    await job.stop();

    expect(removeSpy).toHaveBeenCalledWith("os-job");

    removeSpy.mockRestore();
  });
});

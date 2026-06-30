import { describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { mightThrow, mightThrowSync } from "../../errors/index.js";
import { InvalidRetryError } from "../errors.js";
import { Cron, CronOS, RetryCronJob } from "./index.js";
import type { NotifyContext } from "./types.js";

class UserDefinedError extends Error {}

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

  describe("Retry", () => {
    test("should successfully call onError() callback", async () => {
      setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
      const handler = () => Promise.resolve();

      const retry = new RetryCronJob({
        maxAttempts: 0,
        onError: (err) => {
          expect(err.error).toBeInstanceOf(Error);
          expect(err.error.message).toBe("A generic error");
          expect(err.failedAt).toBe(Date.now());
          expect(err.name).toBe("retry-job");
        },
      });

      const cron = new Cron({
        name: "retry-job",
        schedule: "0 0 * * *",
        handler,
        retry,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      const ctx: NotifyContext = {
        type: "error",
        job: cron,
        error: new Error("A generic error"),
        name: cron.getJobName(),
      };
      await retry.update(ctx);
      expect(cron.getStatus()).toBe("idle");

      setSystemTime();
    });

    test("should successfully throw an error when onError() callback is not defined", async () => {
      const handler = () => Promise.resolve();
      const retry = new RetryCronJob({
        maxAttempts: 0,
      });

      const cron = new Cron({
        name: "retry-job",
        schedule: "0 0 * * *",
        handler,
        retry,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      const ctx: NotifyContext = {
        type: "error",
        job: cron,
        error: new Error("A generic error"),
        name: cron.getJobName(),
      };
      const [theError] = await mightThrow(retry.update(ctx));

      expect(cron.getStatus()).toBe("idle");
      expect(theError).toBeDefined();
      expect(theError?.message).toBe("A generic error");
    });

    test("should successfully call onFailedAttempt() callback", async () => {
      const handler = () => Promise.resolve();

      const retry = new RetryCronJob({
        maxAttempts: 3,
        onFailedAttempt: ({ attemptNumber, delay, error, retriesLeft }) => {
          if (attemptNumber === 1) {
            expect(attemptNumber).toBe(1);
            expect(delay).toBeGreaterThan(0);
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe("A generic error");
            expect(retriesLeft).toBe(3);

            return;
          }

          expect(attemptNumber).toBe(2);
          expect(delay).toBeGreaterThan(0);
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("A generic error");
          expect(retriesLeft).toBe(2);
        },
      });

      const cron = new Cron({
        name: "retry-job",
        schedule: "0 0 * * *",
        handler,
        retry,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      const ctx: NotifyContext = {
        type: "error",
        job: cron,
        error: new Error("A generic error"),
        name: cron.getJobName(),
      };

      await retry.update(ctx);
      expect(cron.getStatus()).toBe("running");

      await retry.update(ctx);
      expect(cron.getStatus()).toBe("running");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should not retry when retryOnError() callback return false", async () => {
      const handler = () => Promise.resolve();

      const retry = new RetryCronJob({
        maxAttempts: 5,
        retryOnError: ({ error: err }) => !(err instanceof UserDefinedError),
      });

      const cron = new Cron({
        name: "retry-job",
        schedule: "0 0 * * *",
        handler,
        retry,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      const ctx: NotifyContext = {
        type: "error",
        job: cron,
        error: new Error("A generic error"),
        name: cron.getJobName(),
      };

      await retry.update(ctx);
      expect(cron.getStatus()).toBe("running");

      const ctxWithCustomError: NotifyContext = {
        type: "error",
        job: cron,
        error: new UserDefinedError("User defined error"),
        name: cron.getJobName(),
      };

      const [userDefinedError] = await mightThrow(
        retry.update(ctxWithCustomError),
      );

      expect(userDefinedError).toBeDefined();
      expect(userDefinedError?.message).toBe("User defined error");
    });

    test("should not retry when retryOnError() callback return false and also call onError() callback", async () => {
      setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
      const handler = () => Promise.resolve();

      const retry = new RetryCronJob({
        maxAttempts: 5,
        retryOnError: ({ error: err }) => !(err instanceof UserDefinedError),
        onError: (err) => {
          expect(err.error).toBeInstanceOf(Error);
          expect(err.error.message).toBe("User defined error");
          expect(err.failedAt).toBe(Date.now());
          expect(err.name).toBe("retry-job");
        },
      });

      const cron = new Cron({
        name: "retry-job",
        schedule: "0 0 * * *",
        handler,
        retry,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");

      cron.run();
      expect(cron.getStatus()).toBe("running");

      const ctx: NotifyContext = {
        type: "error",
        job: cron,
        error: new Error("A generic error"),
        name: cron.getJobName(),
      };

      await retry.update(ctx);
      expect(cron.getStatus()).toBe("running");

      const ctxWithCustomError: NotifyContext = {
        type: "error",
        job: cron,
        error: new UserDefinedError("User defined error"),
        name: cron.getJobName(),
      };

      await retry.update(ctxWithCustomError);

      setSystemTime();
    });

    test("should reset attempts after a success", async () => {
      const handler = () => Promise.resolve();
      const maxAttempts = 10;
      let shouldFail = true;
      const retry = new RetryCronJob({
        maxAttempts,
        onFailedAttempt: ({ retriesLeft }) => {
          if (shouldFail) {
            expect(retriesLeft).toBe(maxAttempts);
          }
        },
      });

      const cron = new Cron({
        name: "retry-job",
        schedule: "0 0 * * *",
        handler,
        retry,
      });

      expect(cron).toBeDefined();
      expect(cron.getStatus()).toBe("idle");

      const ctx: NotifyContext = {
        type: "error",
        job: cron,
        error: new Error("A generic error"),
        name: cron.getJobName(),
      };

      const [firstErr] = await mightThrow(retry.update(ctx));
      expect(firstErr).toBeDefined();

      const [secondErr] = await mightThrow(retry.update(ctx));
      expect(secondErr).toBeDefined();

      shouldFail = true;
      const [thirdErr] = await mightThrow(
        retry.update({ type: "success", name: cron.getJobName() }),
      );
      expect(thirdErr).toBeNull();
    });

    test("keeps per-job retry state when a RetryCronJob instance is shared", async () => {
      const perJobFailes: { retriesLeft: number; jobName: string }[] = [];
      const retry = new RetryCronJob({
        maxAttempts: 2,
        onFailedAttempt: ({ retriesLeft, jobName }) => {
          perJobFailes.push({ retriesLeft, jobName });
        },
      });

      const cronA = new Cron({
        name: "job-a",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
        retry,
      });

      const cronB = new Cron({
        name: "job-b",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
        retry,
      });

      const ctxA: NotifyContext = {
        type: "error",
        job: cronA,
        error: new Error("a"),
        name: cronA.getJobName(),
      };

      const ctxB: NotifyContext = {
        type: "error",
        job: cronB,
        error: new Error("b"),
        name: cronB.getJobName(),
      };

      await retry.update(ctxA);
      await retry.update(ctxB);

      expect(perJobFailes[0]).toMatchObject({
        retriesLeft: 2,
        jobName: "job-a",
      });

      expect(perJobFailes[1]).toMatchObject({
        retriesLeft: 2,
        jobName: "job-b",
      });

      await retry.update(ctxB);

      expect(perJobFailes[0]).toMatchObject({
        retriesLeft: 2,
        jobName: "job-a",
      });

      expect(perJobFailes[2]).toMatchObject({
        retriesLeft: 1,
        jobName: "job-b",
      });
    });

    describe("Validate attempts", () => {
      test("should raise an error when passing a negative number", () => {
        const [retryNegativeNumber] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: -10,
            }),
        );
        expect(retryNegativeNumber).toBeDefined();
        expect(retryNegativeNumber).toBeInstanceOf(InvalidRetryError);

        const [retryNegativeZero] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: -0,
            }),
        );
        expect(retryNegativeZero).toBeDefined();
        expect(retryNegativeZero).toBeInstanceOf(InvalidRetryError);

        const [retryNegativeInfinity] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: Number.NEGATIVE_INFINITY,
            }),
        );
        expect(retryNegativeInfinity).toBeDefined();
        expect(retryNegativeInfinity).toBeInstanceOf(InvalidRetryError);
      });

      test("should raise an error when passing NaN", () => {
        const [retryNan] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: NaN,
            }),
        );

        expect(retryNan).toBeDefined();
        expect(retryNan).toBeInstanceOf(InvalidRetryError);
      });

      test("should raise an error when passing a non-integer number", () => {
        const [decimalNumberRetry] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: 1.5,
            }),
        );

        expect(decimalNumberRetry).toBeDefined();
        expect(decimalNumberRetry).toBeInstanceOf(InvalidRetryError);
      });

      test("should not raise an error when passing a floating point number that can be represented as integer", () => {
        const [decimalNumberRetry] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: 5.0,
            }),
        );

        expect(decimalNumberRetry).toBeNull();
      });

      test("should raise an error when passing 'Infinity'", () => {
        const [infinityRetry] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: Number.POSITIVE_INFINITY,
            }),
        );
        expect(infinityRetry).toBeDefined();
        expect(infinityRetry).toBeInstanceOf(InvalidRetryError);

        const [secondInfinityRetry] = mightThrowSync(
          () =>
            new RetryCronJob({
              maxAttempts: Infinity,
            }),
        );
        expect(secondInfinityRetry).toBeDefined();
        expect(secondInfinityRetry).toBeInstanceOf(InvalidRetryError);
      });
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

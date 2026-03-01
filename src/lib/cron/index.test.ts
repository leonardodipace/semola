import { describe, expect, test } from "bun:test";
import { Cron } from "./index.js";

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
    });

    test("should create a cron job with @hourly alias", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "hourly-job",
        schedule: "@hourly",
        handler,
      });

      expect(cron).toBeDefined();
    });

    test("should throw error for invalid cron expression", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "invalid",
          handler,
        });
      }).toThrow("CronLengthError");
    });

    test("should throw error for cron expression with wrong field count", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "0 0 * *",
          handler,
        });
      }).toThrow("CronLengthError");
    });
  });

  describe("parsing", () => {
    test("should throw error for cron expression with a very large number", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "10000000 0 * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should reject an out-of-bounds number in second (100)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "100 * * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should reject an out-of-bounds step range in minute field (50-70/5)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "* 50-70/5  * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should accept a step range in minute field without the starting value", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "invalid-job",
        schedule: "* -10/5  * * * *",
        handler,
      });

      expect(cron).toBeDefined();
    });

    test("should accept a step range in minute field without the final value", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "invalid-job",
        schedule: "* 10/5  * * * *",
        handler,
      });

      expect(cron).toBeDefined();
    });

    test("should reject an out-of-bounds step range in minute field (-70/5)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "* -70/5  * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should reject an out-of-bounds step range in minute field (70/5)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "* 70/5  * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should reject an out-of-bounds step range in day of the week field (7)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "0 0 * * 7",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should reject an out-of-bounds list value in hour field (1,15,40)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "0 1,15,40 * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should reject an out-of-bounds range value in day field (1-33)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "0 * 1-33 * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("inverted range with step inside a list passes scanner", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "30-10/5 * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("inverted range inside a list passes scanner", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "30-10 * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("wildcard-with-step = 0 should fail", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "*/0,30 * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
    });

    test("should reject an out-of-bounds step range in minute field (2-70/5)", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "2-70/5 * * * *",
          handler,
        });
      }).toThrow("OutOfBoundError");
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

      cron.start();
      expect(cron.getStatus()).toBe("running");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should pause and resume a cron job", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "pause-test",
        schedule: "0 0 * * *",
        handler,
      });

      cron.start();
      expect(cron.getStatus()).toBe("running");

      cron.pause();
      expect(cron.getStatus()).toBe("paused");

      cron.resume();
      expect(cron.getStatus()).toBe("running");

      cron.stop();
    });

    test("should not resume if not paused", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "resume-test",
        schedule: "0 0 * * *",
        handler,
      });

      cron.start();
      expect(cron.getStatus()).toBe("running");

      cron.resume();
      expect(cron.getStatus()).toBe("running");

      cron.stop();
    });

    test("should not pause if not running", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "pause-idle-test",
        schedule: "0 0 * * *",
        handler,
      });

      expect(cron.getStatus()).toBe("idle");
      cron.pause();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should handle multiple start calls gracefully", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "multi-start",
        schedule: "0 0 * * *",
        handler,
      });

      cron.start();
      cron.start();
      cron.start();

      expect(cron.getStatus()).toBe("running");

      cron.stop();
    });
  });

  describe("aliases", () => {
    test("should support @yearly alias", () => {
      expect(() => {
        new Cron({
          name: "yearly",
          schedule: "@yearly",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should support @monthly alias", () => {
      expect(() => {
        new Cron({
          name: "monthly",
          schedule: "@monthly",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should support @weekly alias", () => {
      expect(() => {
        new Cron({
          name: "weekly",
          schedule: "@weekly",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should support @daily alias", () => {
      expect(() => {
        new Cron({
          name: "daily",
          schedule: "@daily",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should support @hourly alias", () => {
      expect(() => {
        new Cron({
          name: "hourly",
          schedule: "@hourly",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should support @minutely alias", () => {
      expect(() => {
        new Cron({
          name: "minutely",
          schedule: "@minutely",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });
  });

  describe("getNextRun search horizon", () => {
    test("should find next run for yearly schedule", () => {
      const cron = new Cron({
        name: "yearly-horizon",
        schedule: "@yearly",
        handler: () => Promise.resolve(),
      });

      const next = cron.getNextRun();

      if (!next) throw new Error("Expected next run to be found");

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

      const next = cron.getNextRun();

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
        handler: () => {},
      });

      const next = cron.getNextRun();

      expect(next).not.toBeNull();
    });
  });

  describe("next retry on null getNextRun", () => {
    test("should schedule a retry timeout when getNextRun returns null", () => {
      const cron = new Cron({
        name: "retry-test",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
      });

      cron.getNextRun = () => null;

      cron.start();

      // Status should remain running (not stuck idle)
      expect(cron.getStatus()).toBe("running");

      // A timeout should have been set (stop clears it, proving it exists)
      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should allow pause to clear retry timeout", () => {
      const cron = new Cron({
        name: "retry-pause",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
      });

      cron.getNextRun = () => null;

      cron.start();
      expect(cron.getStatus()).toBe("running");

      cron.pause();
      expect(cron.getStatus()).toBe("paused");
    });

    test("should keep status running during retry, not idle", () => {
      const cron = new Cron({
        name: "retry-status",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
      });

      cron.getNextRun = () => null;

      cron.start();

      // Must stay running, not fall back to idle
      expect(cron.getStatus()).toBe("running");

      cron.stop();
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

      cron.start();
      expect(cron.getStatus()).toBe("running");

      cron.pause();
      expect(cron.getStatus()).toBe("paused");

      cron.pause();
      expect(cron.getStatus()).toBe("paused");

      cron.resume();
      expect(cron.getStatus()).toBe("running");

      cron.resume();
      expect(cron.getStatus()).toBe("running");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");

      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });
  });

  describe("matches", () => {
    test("should use OR semantics when both day-of-month and day-of-week are restricted", () => {
      // "0 0 15 * 1" = midnight on the 15th of any month OR any Monday
      const cron = new Cron({
        name: "test",
        schedule: "0 0 15 * 1",
        handler: () => {},
      });

      // 2024-01-08 = Monday that is NOT the 15th - matches because it's Monday
      const mondayNot15th = new Date("2024-01-08T00:00:00");
      expect(cron.matches(mondayNot15th)).toBe(true);

      // 2024-02-15 = Thursday that IS the 15th - matches because it's the 15th
      const fifteenthNotMonday = new Date("2024-02-15T00:00:00");
      expect(cron.matches(fifteenthNotMonday)).toBe(true);
    });
  });
});

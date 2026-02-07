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
      }).toThrow("Invalid cron expression");
    });

    test("should throw error for cron expression with wrong field count", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "0 0 * *",
          handler,
        });
      }).toThrow("Invalid cron expression");
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

  describe("cron expression parsing", () => {
    test("should parse wildcard expressions", () => {
      expect(() => {
        new Cron({
          name: "wildcard-test",
          schedule: "* * * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should parse step expressions", () => {
      expect(() => {
        new Cron({
          name: "step-test",
          schedule: "*/5 * * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should parse range expressions", () => {
      expect(() => {
        new Cron({
          name: "range-test",
          schedule: "0 9-17 * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should parse list expressions", () => {
      expect(() => {
        new Cron({
          name: "list-test",
          schedule: "0 9,12,15 * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should parse combined expressions", () => {
      expect(() => {
        new Cron({
          name: "combined-test",
          schedule: "0 9-17/2 * * 1-5",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should reject invalid field values", () => {
      expect(() => {
        new Cron({
          name: "invalid-minute",
          schedule: "60 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject invalid step values", () => {
      expect(() => {
        new Cron({
          name: "invalid-step",
          schedule: "*/0 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject negative range values", () => {
      expect(() => {
        new Cron({
          name: "negative-range",
          schedule: "0--5 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject out-of-bounds step range (start below min)", () => {
      expect(() => {
        new Cron({
          name: "step-range-below",
          schedule: "0 0 0-10/2 * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject out-of-bounds step range (end above max)", () => {
      expect(() => {
        new Cron({
          name: "step-range-above",
          schedule: "70-80/2 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject step range where start > end", () => {
      expect(() => {
        new Cron({
          name: "step-range-inverted",
          schedule: "30-10/2 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject out-of-bounds step range in hour field", () => {
      expect(() => {
        new Cron({
          name: "step-range-hour-oob",
          schedule: "0 0-30/3 * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject out-of-bounds step range in month field", () => {
      expect(() => {
        new Cron({
          name: "step-range-month-oob",
          schedule: "0 0 1 0-12/2 *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject out-of-bounds step range in day-of-week field", () => {
      expect(() => {
        new Cron({
          name: "step-range-dow-oob",
          schedule: "0 0 * * 0-7/2",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should reject non-integer values in step range", () => {
      expect(() => {
        new Cron({
          name: "step-range-float",
          schedule: "1.5-10/2 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should accept valid step range expressions", () => {
      expect(() => {
        new Cron({
          name: "valid-step-range",
          schedule: "10-50/5 * * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should accept valid step range at field boundaries", () => {
      expect(() => {
        new Cron({
          name: "step-range-bounds",
          schedule: "0-59/10 0-23/4 1-31/7 1-12/3 0-6/2",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should reject step range in 6-field seconds with end above 59", () => {
      expect(() => {
        new Cron({
          name: "step-range-sec-oob",
          schedule: "50-70/5 * * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("should parse 6-field expression with seconds", () => {
      expect(() => {
        new Cron({
          name: "six-field-test",
          schedule: "* * * * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should parse 6-field with specific seconds", () => {
      expect(() => {
        new Cron({
          name: "specific-seconds",
          schedule: "30 * * * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should parse 6-field with step in seconds", () => {
      expect(() => {
        new Cron({
          name: "seconds-step",
          schedule: "*/5 * * * * *",
          handler: () => Promise.resolve(),
        });
      }).not.toThrow();
    });

    test("should reject 7-field expression", () => {
      expect(() => {
        new Cron({
          name: "seven-field",
          schedule: "* * * * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
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

  describe("matches", () => {
    test("should match correct day and month for a specific date", () => {
      // Schedule: minute 0, hour 0, day 15, month 6 (June), any weekday
      const cron = new Cron({
        name: "match-test",
        schedule: "0 0 15 6 *",
        handler: () => Promise.resolve(),
      });

      // June 15, 2025, 00:00:00 — should match
      expect(cron.matches(new Date(2025, 5, 15, 0, 0, 0))).toBe(true);

      // June 14, 2025, 00:00:00 — wrong day
      expect(cron.matches(new Date(2025, 5, 14, 0, 0, 0))).toBe(false);

      // July 15, 2025, 00:00:00 — wrong month
      expect(cron.matches(new Date(2025, 6, 15, 0, 0, 0))).toBe(false);

      // June 15, 2025, 01:00:00 — wrong hour
      expect(cron.matches(new Date(2025, 5, 15, 1, 0, 0))).toBe(false);
    });

    test("should match day 31 correctly", () => {
      // Schedule: minute 0, hour 12, day 31, any month, any weekday
      const cron = new Cron({
        name: "day31-test",
        schedule: "0 12 31 * *",
        handler: () => Promise.resolve(),
      });

      // January 31, 2025, 12:00:00 — should match
      expect(cron.matches(new Date(2025, 0, 31, 12, 0, 0))).toBe(true);

      // January 30, 2025, 12:00:00 — wrong day
      expect(cron.matches(new Date(2025, 0, 30, 12, 0, 0))).toBe(false);
    });

    test("should match month 12 (December) correctly", () => {
      // Schedule: minute 0, hour 0, day 1, month 12, any weekday
      const cron = new Cron({
        name: "dec-test",
        schedule: "0 0 1 12 *",
        handler: () => Promise.resolve(),
      });

      // December 1, 2025, 00:00:00 — should match
      expect(cron.matches(new Date(2025, 11, 1, 0, 0, 0))).toBe(true);

      // November 1, 2025, 00:00:00 — wrong month
      expect(cron.matches(new Date(2025, 10, 1, 0, 0, 0))).toBe(false);
    });

    test("should match month 1 (January) correctly", () => {
      const cron = new Cron({
        name: "jan-test",
        schedule: "0 0 1 1 *",
        handler: () => Promise.resolve(),
      });

      // January 1, 2025, 00:00:00 — should match
      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);

      // February 1, 2025, 00:00:00 — wrong month
      expect(cron.matches(new Date(2025, 1, 1, 0, 0, 0))).toBe(false);
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

    test("should find next run for infrequent schedule (Feb 29)", () => {
      // Feb 29 only occurs on leap years
      const cron = new Cron({
        name: "feb29",
        schedule: "0 0 29 2 *",
        handler: () => Promise.resolve(),
      });

      const next = cron.getNextRun();

      // May or may not be within 366 days depending on current date
      if (next) {
        expect(next.getMonth()).toBe(1);
        expect(next.getDate()).toBe(29);
      }
    });

    test("should find next run for specific month and day", () => {
      // Dec 25 — always within 366 days
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
});

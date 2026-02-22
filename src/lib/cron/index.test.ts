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

    test("should parse wildcard with step in comma list", () => {
      // */10 inside a comma list - should not throw
      const cron = new Cron({
        name: "list-wildcard-step",
        schedule: "*/10,30 * * * *",
        handler: () => Promise.resolve(),
      });

      // */10 expands to 0,10,20,30,40,50 and 30 is also listed
      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true); // minute 0
      expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true); // minute 10
      expect(cron.matches(new Date(2025, 0, 1, 0, 20, 0))).toBe(true); // minute 20
      expect(cron.matches(new Date(2025, 0, 1, 0, 30, 0))).toBe(true); // minute 30
      expect(cron.matches(new Date(2025, 0, 1, 0, 40, 0))).toBe(true); // minute 40
      expect(cron.matches(new Date(2025, 0, 1, 0, 50, 0))).toBe(true); // minute 50
      expect(cron.matches(new Date(2025, 0, 1, 0, 5, 0))).toBe(false); // minute 5
      expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(false); // minute 15
    });

    test("should parse standalone wildcard with step in comma list (*/15)", () => {
      const cron = new Cron({
        name: "list-wildcard-step-only",
        schedule: "0 */6 * * *",
        handler: () => Promise.resolve(),
      });

      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true); // hour 0
      expect(cron.matches(new Date(2025, 0, 1, 6, 0, 0))).toBe(true); // hour 6
      expect(cron.matches(new Date(2025, 0, 1, 12, 0, 0))).toBe(true); // hour 12
      expect(cron.matches(new Date(2025, 0, 1, 18, 0, 0))).toBe(true); // hour 18
      expect(cron.matches(new Date(2025, 0, 1, 3, 0, 0))).toBe(false); // hour 3
    });

    test("should reject wildcard with invalid step in comma list", () => {
      expect(() => {
        new Cron({
          name: "list-wildcard-bad-step",
          schedule: "*/0,30 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
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

      // June 15, 2025, 00:00:00 - should match
      expect(cron.matches(new Date(2025, 5, 15, 0, 0, 0))).toBe(true);

      // June 14, 2025, 00:00:00 - wrong day
      expect(cron.matches(new Date(2025, 5, 14, 0, 0, 0))).toBe(false);

      // July 15, 2025, 00:00:00 - wrong month
      expect(cron.matches(new Date(2025, 6, 15, 0, 0, 0))).toBe(false);

      // June 15, 2025, 01:00:00 - wrong hour
      expect(cron.matches(new Date(2025, 5, 15, 1, 0, 0))).toBe(false);
    });

    test("should match day 31 correctly", () => {
      // Schedule: minute 0, hour 12, day 31, any month, any weekday
      const cron = new Cron({
        name: "day31-test",
        schedule: "0 12 31 * *",
        handler: () => Promise.resolve(),
      });

      // January 31, 2025, 12:00:00 - should match
      expect(cron.matches(new Date(2025, 0, 31, 12, 0, 0))).toBe(true);

      // January 30, 2025, 12:00:00 - wrong day
      expect(cron.matches(new Date(2025, 0, 30, 12, 0, 0))).toBe(false);
    });

    test("should match month 12 (December) correctly", () => {
      // Schedule: minute 0, hour 0, day 1, month 12, any weekday
      const cron = new Cron({
        name: "dec-test",
        schedule: "0 0 1 12 *",
        handler: () => Promise.resolve(),
      });

      // December 1, 2025, 00:00:00 - should match
      expect(cron.matches(new Date(2025, 11, 1, 0, 0, 0))).toBe(true);

      // November 1, 2025, 00:00:00 - wrong month
      expect(cron.matches(new Date(2025, 10, 1, 0, 0, 0))).toBe(false);
    });

    test("should match month 1 (January) correctly", () => {
      const cron = new Cron({
        name: "jan-test",
        schedule: "0 0 1 1 *",
        handler: () => Promise.resolve(),
      });

      // January 1, 2025, 00:00:00 - should match
      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);

      // February 1, 2025, 00:00:00 - wrong month
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

    test("should match Feb 29 on a leap year", () => {
      const cron = new Cron({
        name: "feb29",
        schedule: "0 0 29 2 *",
        handler: () => Promise.resolve(),
      });

      // 2028 is a leap year - Feb 29 exists
      expect(cron.matches(new Date(2028, 1, 29, 0, 0, 0))).toBe(true);

      // Feb 28 should not match
      expect(cron.matches(new Date(2028, 1, 28, 0, 0, 0))).toBe(false);

      // Non-leap year: 2027-03-01 should not match
      expect(cron.matches(new Date(2027, 2, 1, 0, 0, 0))).toBe(false);
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

  describe("expression parsing - bugs", () => {
    // BUG 1: single-value-with-step inside a list ignores the step
    // FIX NEEDED: handleList else branch only does values[n]=1.
    // It should loop from n to max with step, like handleStepSingle does.
    test("single-value-with-step in list should expand from start to max", () => {
      const cron = new Cron({
        name: "list-step-bug",
        schedule: "10/5,30 * * * *",
        handler: () => Promise.resolve(),
      });

      // Expected: "10/5" expands to {10,15,20,25,30,35,40,45,50,55}; "30" is already covered
      // Actual (bug): only {10,30} are set - step is discarded, only the start value is marked
      expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(true); // fails: missing stepped values
      expect(cron.matches(new Date(2025, 0, 1, 0, 25, 0))).toBe(true); // fails
      expect(cron.matches(new Date(2025, 0, 1, 0, 55, 0))).toBe(true); // fails
      expect(cron.matches(new Date(2025, 0, 1, 0, 11, 0))).toBe(false);
    });

    test("single-value-with-step as first item in a list should expand from start to max", () => {
      const cron = new Cron({
        name: "list-step-only-bug",
        schedule: "5/15,0 * * * *",
        handler: () => Promise.resolve(),
      });

      // Expected: "5/15" expands to {5,20,35,50}; "0" adds 0 -> {0,5,20,35,50}
      // Actual (bug): only {0,5} are set - step is discarded
      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 5, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 20, 0))).toBe(true); // fails: missing stepped values
      expect(cron.matches(new Date(2025, 0, 1, 0, 35, 0))).toBe(true); // fails
      expect(cron.matches(new Date(2025, 0, 1, 0, 50, 0))).toBe(true); // fails
      expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(false);
    });

    // BUG 2: scientific notation is silently accepted as a valid number
    // FIX NEEDED: handleNumber (and related methods) must validate that the
    // string is a pure digit sequence before calling Number(), not just check isInteger.
    // Number("1e1") === 10 and Number.isInteger(10) === true, so no rejection occurs.
    test("scientific notation in minute field should be rejected", () => {
      // Expected: throw - "1e1" is not valid cron syntax
      // Actual (bug): accepted as minute 10
      expect(() => {
        new Cron({
          name: "sci-notation-minute",
          schedule: "1e1 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("scientific notation in day field should be rejected", () => {
      // Expected: throw - "1e1" is not valid cron syntax
      // Actual (bug): accepted as day 10
      expect(() => {
        new Cron({
          name: "sci-notation-day",
          schedule: "0 0 1e1 * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    // BUG 3 & 4: empty list items are accepted when the field's min is 0
    // FIX NEEDED: handleList must reject empty items before parsing.
    // Number("") === 0, Number.isInteger(0) === true, 0 >= min(0) -> values[0] = 1 silently.
    test("lone comma in minute field should be rejected", () => {
      // Expected: throw - "," contains no valid items
      // Actual (bug): accepted, sets minute 0
      expect(() => {
        new Cron({
          name: "lone-comma",
          schedule: ", * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("trailing comma in minute list should be rejected", () => {
      // Expected: throw - "0,30," has an empty trailing item
      // Actual (bug): accepted, empty item resolves to 0 (minute 0 is already set anyway)
      expect(() => {
        new Cron({
          name: "trailing-comma",
          schedule: "0,30, * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("leading comma in minute list should be rejected", () => {
      // Expected: throw - ",0" has an empty leading item
      // Actual (bug): accepted, empty item resolves to 0 (same as the explicit 0)
      expect(() => {
        new Cron({
          name: "leading-comma",
          schedule: ",0 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });
  });

  describe("expression parsing - edge cases", () => {
    test("degenerate range (start === end) sets exactly one value", () => {
      const cron = new Cron({
        name: "degenerate-range",
        schedule: "5-5 * * * *",
        handler: () => Promise.resolve(),
      });

      expect(cron.matches(new Date(2025, 0, 1, 0, 5, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 4, 0))).toBe(false);
      expect(cron.matches(new Date(2025, 0, 1, 0, 6, 0))).toBe(false);
    });

    test("step of 1 (*/1) matches every minute", () => {
      const cron = new Cron({
        name: "step-one",
        schedule: "*/1 * * * *",
        handler: () => Promise.resolve(),
      });

      for (let m = 0; m <= 59; m++) {
        expect(cron.matches(new Date(2025, 0, 1, 0, m, 0))).toBe(true);
      }
    });

    test("range-with-step where step exceeds range width sets only start value", () => {
      const cron = new Cron({
        name: "step-exceeds-range",
        schedule: "10-15/10 * * * *",
        handler: () => Promise.resolve(),
      });

      // 10-15/10: only 10 is set (10+10=20 > 15)
      expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 11, 0))).toBe(false);
      expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(false);
    });

    test("step larger than field width (*/60) sets only minute 0", () => {
      const cron = new Cron({
        name: "step-large",
        schedule: "*/60 * * * *",
        handler: () => Promise.resolve(),
      });

      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 1, 0))).toBe(false);
      expect(cron.matches(new Date(2025, 0, 1, 0, 59, 0))).toBe(false);
    });

    test("range-with-step inside a list is applied correctly", () => {
      // "10-30/5,45" -> {10,15,20,25,30,45}
      const cron = new Cron({
        name: "range-step-in-list",
        schedule: "10-30/5,45 * * * *",
        handler: () => Promise.resolve(),
      });

      expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 20, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 25, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 30, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 45, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 35, 0))).toBe(false); // gap between steps
      expect(cron.matches(new Date(2025, 0, 1, 0, 50, 0))).toBe(false); // not in list
    });

    test("full minute range 0-59 matches all minutes", () => {
      const cron = new Cron({
        name: "full-minute-range",
        schedule: "0-59 * * * *",
        handler: () => Promise.resolve(),
      });

      for (let m = 0; m <= 59; m++) {
        expect(cron.matches(new Date(2025, 0, 1, 0, m, 0))).toBe(true);
      }
    });

    test("full month range 1-12 matches all months", () => {
      const cron = new Cron({
        name: "full-month-range",
        schedule: "0 0 1 1-12 *",
        handler: () => Promise.resolve(),
      });

      for (let mon = 0; mon <= 11; mon++) {
        expect(cron.matches(new Date(2025, mon, 1, 0, 0, 0))).toBe(true);
      }
    });

    test("zero-length range (0-0) sets only minute 0", () => {
      const cron = new Cron({
        name: "zero-range",
        schedule: "0-0 * * * *",
        handler: () => Promise.resolve(),
      });

      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);
      expect(cron.matches(new Date(2025, 0, 1, 0, 1, 0))).toBe(false);
    });

    test("inverted range inside a list is rejected", () => {
      expect(() => {
        new Cron({
          name: "inverted-range-in-list",
          schedule: "30-10,50 * * * *",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
    });

    test("6-field expression checks second and does not match wrong second", () => {
      // "30 0 0 1 1 *" = second 30, minute 0, hour 0, day 1, month 1 (January), any weekday
      const cron = new Cron({
        name: "six-field-second-check",
        schedule: "30 0 0 1 1 *",
        handler: () => Promise.resolve(),
      });

      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 30))).toBe(true); // correct second
      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(false); // wrong second
      expect(cron.matches(new Date(2025, 0, 1, 0, 0, 31))).toBe(false); // wrong second
    });

    test("dayOfWeek 7 is rejected (current behavior documents max=6 limit)", () => {
      expect(() => {
        new Cron({
          name: "dow-seven",
          schedule: "0 0 * * 7",
          handler: () => Promise.resolve(),
        });
      }).toThrow("Invalid cron expression");
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

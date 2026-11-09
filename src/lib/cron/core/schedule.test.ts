import { afterEach, describe, expect, test } from "bun:test";
import { nextRun, parseExpression } from "./schedule.js";

const next = (expression: string, from: Date | number) => {
  return nextRun(parseExpression(expression), from);
};

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
    return;
  }

  process.env.TZ = originalTimezone;
});

describe("parseExpression", () => {
  test("should reject expressions without five fields", () => {
    expect(() => parseExpression("* * * *")).toThrow(TypeError);
    expect(() => parseExpression("* * * * * *")).toThrow(TypeError);
    expect(() => parseExpression("")).toThrow(TypeError);
  });

  test("should reject out of range values", () => {
    expect(() => parseExpression("60 * * * *")).toThrow(TypeError);
    expect(() => parseExpression("* 24 * * *")).toThrow(TypeError);
    expect(() => parseExpression("* * 0 * *")).toThrow(TypeError);
    expect(() => parseExpression("* * 32 * *")).toThrow(TypeError);
    expect(() => parseExpression("* * * 13 *")).toThrow(TypeError);
    expect(() => parseExpression("* * * * 8")).toThrow(TypeError);
  });

  test("should reject malformed fields", () => {
    expect(() => parseExpression("*/0 * * * *")).toThrow(TypeError);
    expect(() => parseExpression("5-3 * * * *")).toThrow(TypeError);
    expect(() => parseExpression("1, * * * *")).toThrow(TypeError);
    expect(() => parseExpression("*/2/3 * * * *")).toThrow(TypeError);
    expect(() => parseExpression("a * * * *")).toThrow(TypeError);
    expect(() => parseExpression("* * * * Mo")).toThrow(TypeError);
    expect(() => parseExpression("* * * */mar *")).toThrow(TypeError);
  });

  test("should expand lists, ranges, steps and open steps", () => {
    const fields = parseExpression("1,5-7,10-20/5 5/20 * * *");

    expect(fields.minutes).toEqual([1, 5, 6, 7, 10, 15, 20]);
    expect(fields.hours).toEqual([5]);
  });

  test("should read month and weekday names in any case", () => {
    const fields = parseExpression("0 0 * JAN,march Mon-fri,Sunday");

    expect([...fields.months]).toEqual([1, 3]);
    expect([...fields.weekdays].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("should treat weekday 7 as Sunday", () => {
    const fields = parseExpression("0 0 * * 6-7");

    expect([...fields.weekdays].sort()).toEqual([0, 6]);
  });

  test("should tolerate extra whitespace", () => {
    expect(() => parseExpression("  0   0 * *  * ")).not.toThrow();
  });
});

describe("nextRun", () => {
  test("should return a time strictly after the start", () => {
    const from = new Date(2026, 2, 15, 10, 8, 0, 0);

    expect(next("* * * * *", from)).toEqual(new Date(2026, 2, 15, 10, 9));
    expect(next("* * * * *", new Date(2026, 2, 15, 10, 7, 59, 999))).toEqual(
      new Date(2026, 2, 15, 10, 8),
    );
  });

  test("should match either day or weekday when both are restricted", () => {
    // Sunday 2026-03-15: the 13th has passed, so the next Friday (20th) wins.
    expect(next("0 0 13 * 5", new Date(2026, 2, 15))).toEqual(
      new Date(2026, 2, 20),
    );
  });

  test("should match both day and weekday when one is a wildcard", () => {
    expect(next("0 0 13 * *", new Date(2026, 2, 15))).toEqual(
      new Date(2026, 3, 13),
    );
  });

  test("should skip to the next leap year for Feb 29", () => {
    expect(next("0 0 29 2 *", new Date(2026, 2, 1))).toEqual(
      new Date(2028, 1, 29),
    );
    expect(next("0 0 29 2 *", new Date(2096, 2, 1))).toEqual(
      new Date(2104, 1, 29),
    );
  });

  test("should return null for a date that never exists", () => {
    expect(next("0 0 31 4 *", new Date(2026, 2, 1))).toBeNull();
    expect(next("0 0 30 2 *", new Date(2026, 2, 1))).toBeNull();
  });

  test("should throw on an invalid start", () => {
    expect(() => next("* * * * *", Number.NaN)).toThrow(TypeError);
    expect(() => next("* * * * *", Number.POSITIVE_INFINITY)).toThrow(
      TypeError,
    );
  });

  test("should pause an hourly schedule for the repeated hour", () => {
    process.env.TZ = "America/New_York";

    // Clocks go back at 06:00Z on 2026-11-01, repeating 01:00-02:00.
    const next1 = next("0 * * * *", new Date("2026-11-01T05:30:00Z"));

    expect(next1).toEqual(new Date("2026-11-01T07:00:00Z"));
  });

  test("should run every match inside a skipped hour, shifted forward", () => {
    process.env.TZ = "America/New_York";

    // Clocks go forward at 07:00Z on 2026-03-08, skipping 02:00-03:00.
    const first = next("0,30 2 * * *", new Date("2026-03-08T06:00:00Z"));
    const second = next("0,30 2 * * *", new Date("2026-03-08T07:00:00Z"));

    expect(first).toEqual(new Date("2026-03-08T07:00:00Z"));
    expect(second).toEqual(new Date("2026-03-08T07:30:00Z"));
  });

  test("should not mutate the start date", () => {
    const from = new Date(2026, 2, 15, 10, 7, 30);
    const snapshot = from.getTime();

    next("* * * * *", from);

    expect(from.getTime()).toBe(snapshot);
  });
});

// Bun.cron.parse is the behavior Cron had before the scheduler was ported.
describe("compared with Bun.cron.parse", () => {
  // Fixed times of day agree everywhere, including across DST changes.
  const fixedTimes = [
    "0 0 * * 7",
    "0 0 * * SUN",
    "0 0 1 JAN *",
    "0 0 * * mon-fri",
    "0 0 13 * 5",
    "0 0 */2 * 5",
    "0 0 13 * */2",
    "0 0 29 2 *",
    "0 0 31 2 *",
    "0 0 29 2 1",
    "30 2 * * *",
    "30 1 * * *",
    "15 1,2 * * *",
    "59 23 31 12 *",
    "0 0 1 1 *",
    "15 14 1 * *",
    "0 22 * * 1-5",
    "0 0 * * Monday",
    "0 0 1 January *",
  ];

  // Schedules that fire many times a day pause for the repeated hour when
  // clocks go back, so they are only compared away from DST changes.
  const frequent = [
    "* * * * *",
    "*/5 * * * *",
    "5-10/2 * * * *",
    "5/15 * * * *",
    "1,2,3 * * * *",
    "0 * * * *",
    "*/20 * * * *",
    "15 */1 * * *",
    "0 0-23 * * *",
  ];

  const plainStarts = [
    new Date("2026-03-15T10:07:30Z"),
    new Date("2026-12-31T23:59:59Z"),
    new Date("2096-03-01T00:00:00Z"),
  ];

  const dstStarts = [
    new Date("2026-03-08T05:00:00Z"),
    new Date("2026-03-08T06:59:59Z"),
    new Date("2026-03-08T07:30:00Z"),
    new Date("2026-03-29T00:30:00Z"),
    new Date("2026-10-25T00:30:00Z"),
    new Date("2026-11-01T04:00:00Z"),
    new Date("2026-11-01T05:40:00Z"),
    new Date("2026-11-01T06:40:00Z"),
    new Date("2026-10-25T00:59:30Z"),
    new Date("2026-10-25T01:30:00Z"),
    new Date("2026-04-04T15:30:00Z"),
    new Date("2026-10-03T15:30:00Z"),
    new Date("2026-04-04T16:30:00Z"),
  ];

  const zones = [
    "UTC",
    "America/New_York",
    "Europe/Berlin",
    "Asia/Kolkata",
    "Australia/Sydney",
  ];

  const expectSameRun = (expression: string, from: Date) => {
    const ours = next(expression, from);
    const theirs = Bun.cron.parse(expression, from);

    expect([expression, from, ours]).toEqual([expression, from, theirs]);
  };

  for (const zone of zones) {
    test(`should agree on next run in ${zone}`, () => {
      process.env.TZ = zone;

      for (const expression of fixedTimes) {
        for (const from of [...plainStarts, ...dstStarts]) {
          expectSameRun(expression, from);
        }
      }

      for (const expression of frequent) {
        for (const from of plainStarts) {
          expectSameRun(expression, from);
        }
      }
    });
  }

  test("should agree on which expressions are invalid", () => {
    const invalid = [
      "",
      "* * * *",
      "* * * * * *",
      "60 * * * *",
      "* * * 13 *",
      "*/0 * * * *",
      "5-3 * * * *",
      "1, * * * *",
      "a * * * *",
      "0 0 L * *",
      "@reboot",
    ];

    for (const expression of invalid) {
      expect(() => Bun.cron.parse(expression)).toThrow(TypeError);
      expect(() => parseExpression(expression)).toThrow(TypeError);
    }
  });
});

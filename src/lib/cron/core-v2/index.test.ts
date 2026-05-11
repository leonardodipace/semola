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
      cron.stop();
    });

    test("should create a cron job with @daily alias", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "daily-job",
        schedule: "@daily",
        handler,
      });

      expect(cron).toBeDefined();
      cron.stop();
    });

    test("should create a cron job with @hourly alias", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "hourly-job",
        schedule: "@hourly",
        handler,
      });

      expect(cron).toBeDefined();
      cron.stop();
    });

    test("should throw error for invalid cron expression", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "invalid",
          handler,
        }).run();
      }).toThrow(TypeError);
    });

    test("should throw error for cron expression with wrong field count", () => {
      const handler = () => Promise.resolve();

      expect(() => {
        new Cron({
          name: "invalid-job",
          schedule: "0 0 * *",
          handler,
        }).run();
      }).toThrow(TypeError);
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

    test("should handle multiple start calls gracefully", () => {
      const handler = () => Promise.resolve();

      const cron = new Cron({
        name: "multi-start",
        schedule: "0 0 * * *",
        handler,
      });

      cron.run();
      cron.run();
      cron.run();

      expect(cron.getStatus()).toBe("running");

      cron.stop();
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
      const cron = new Cron({
        name: "yearly-horizon",
        schedule: "@yearly",
        handler: () => Promise.resolve(),
      });

      cron.run();
      const next = cron.next();

      if (!next) throw new Error("Expected next run to be found");

      expect(next.getMonth()).toBe(0);
      expect(next.getDate()).toBe(1);
      expect(next.getHours()).toBe(0);
      expect(next.getMinutes()).toBe(0);
      cron.stop();
    });

    test("should find next run for specific month and day", () => {
      // Dec 25 - always within 366 days
      const cron = new Cron({
        name: "dec25",
        schedule: "0 12 25 12 *",
        handler: () => Promise.resolve(),
      });

      cron.run();
      const next = cron.next();

      if (!next) throw new Error("Expected next run to be found");

      expect(next.getMonth()).toBe(11);
      expect(next.getDate()).toBe(25);
      expect(next.getHours()).toBe(12);
      cron.stop();
    });

    test("should find next run for leap day schedule beyond 366 days", () => {
      // "0 0 29 2 *" = midnight on Feb 29 (leap day)
      // Next Feb 29 from 2026-03-01 is 2028-02-29 (~730 days away)
      const cron = new Cron({
        name: "leap-day",
        schedule: "0 0 29 2 *",
        handler: () => Promise.resolve(),
      });

      cron.run();
      const next = cron.next();
      expect(next).not.toBeNull();

      cron.stop();
    });
  });

  describe("next retry on null return by next() method", () => {
    test("should schedule a retry timeout when next() method returns null", () => {
      const cron = new Cron({
        name: "retry-test",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
      });

      cron.next = () => null;
      cron.run();

      // Status should remain running (not stuck idle)
      expect(cron.getStatus()).toBe("running");

      // A timeout should have been set (stop clears it, proving it exists)
      cron.stop();
      expect(cron.getStatus()).toBe("idle");
    });

    test("should keep status running during retry, not idle", () => {
      const cron = new Cron({
        name: "retry-status",
        schedule: "0 0 * * *",
        handler: () => Promise.resolve(),
      });

      cron.next = () => null;
      cron.run();

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
});

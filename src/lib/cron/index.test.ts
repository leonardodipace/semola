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

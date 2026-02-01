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

import { describe, expect, test } from "bun:test";
import { defineMigration } from "./define.js";

describe("defineMigration", () => {
  test("returns migration object with up and down handlers", () => {
    const called: string[] = [];

    const migration = defineMigration({
      up: async (_t) => {
        called.push("up");
      },
      down: async (_t) => {
        called.push("down");
      },
    });

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(called.length).toBe(0);
  });
});

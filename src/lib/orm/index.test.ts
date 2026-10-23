import { describe, expect, test } from "bun:test";
import * as orm from "./index.js";

describe("semola/orm exports", () => {
  test("exports applyMigrations and loadConfig", () => {
    expect(typeof orm.applyMigrations).toBe("function");
    expect(typeof orm.loadConfig).toBe("function");
    expect(orm.MigrationError.prototype).toBeInstanceOf(Error);
  });
});

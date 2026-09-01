import { describe, expect, test } from "bun:test";
import { getMigrationDialect } from "./index.js";

describe("getMigrationDialect", () => {
  test("returns sqlite dialect for sqlite adapter", () => {
    expect(getMigrationDialect("sqlite").name).toBe("sqlite");
  });

  test("returns postgres dialect for postgres adapter", () => {
    expect(getMigrationDialect("postgres").name).toBe("postgres");
  });

  test("throws for unsupported adapters", () => {
    const adapter = "mysql";

    expect(() =>
      // @ts-expect-error - testing runtime guard for values outside the Adapter type
      getMigrationDialect(adapter),
    ).toThrow("Unsupported adapter: mysql");
  });
});

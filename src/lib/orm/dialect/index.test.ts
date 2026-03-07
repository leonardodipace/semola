import { describe, expect, test } from "bun:test";
import { getDialectAdapter } from "./index.js";

describe("getDialectAdapter", () => {
  test("returns postgres adapter", () => {
    expect(getDialectAdapter("postgres").dialect).toBe("postgres");
  });

  test("returns mysql adapter", () => {
    expect(getDialectAdapter("mysql").dialect).toBe("mysql");
  });

  test("returns sqlite adapter", () => {
    expect(getDialectAdapter("sqlite").dialect).toBe("sqlite");
  });
});

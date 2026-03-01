import { describe, expect, test } from "bun:test";
import { sqliteDialectAdapter } from "./sqlite.js";

describe("sqliteDialectAdapter", () => {
  test("converts booleans to integers", () => {
    expect(sqliteDialectAdapter.serializeValue("boolean", true)).toBe(1);
    expect(sqliteDialectAdapter.serializeValue("boolean", false)).toBe(0);
  });

  test("serializes json values", () => {
    expect(sqliteDialectAdapter.serializeValue("jsonb", { a: 1 })).toBe(
      '{"a":1}',
    );
  });

  test("quotes identifiers with double quotes", () => {
    expect(sqliteDialectAdapter.quoteIdentifier("users")).toBe('"users"');
  });
});

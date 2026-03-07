import { describe, expect, test } from "bun:test";
import { mysqlDialectAdapter } from "./mysql.js";

describe("mysqlDialectAdapter", () => {
  test("converts booleans to integers", () => {
    expect(mysqlDialectAdapter.serializeValue("boolean", true)).toBe(1);
    expect(mysqlDialectAdapter.serializeValue("boolean", false)).toBe(0);
  });

  test("serializes json values", () => {
    expect(mysqlDialectAdapter.serializeValue("json", { a: 1 })).toBe(
      '{"a":1}',
    );
  });

  test("quotes identifiers with backticks", () => {
    expect(mysqlDialectAdapter.quoteIdentifier("users")).toBe("`users`");
  });
});

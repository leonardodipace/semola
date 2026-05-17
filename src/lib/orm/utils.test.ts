import { describe, expect, test } from "bun:test";
import { quoteIdentifier } from "./utils.js";

describe("quoteIdentifier", () => {
  test("wraps identifiers in double quotes", () => {
    expect(quoteIdentifier("users")).toBe('"users"');
    expect(quoteIdentifier("created_at")).toBe('"created_at"');
  });
});

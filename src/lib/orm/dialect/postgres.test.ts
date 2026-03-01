import { describe, expect, test } from "bun:test";
import { postgresDialectAdapter } from "./postgres.js";

describe("postgresDialectAdapter", () => {
  test("keeps booleans unchanged", () => {
    expect(postgresDialectAdapter.serializeValue("boolean", true)).toBe(true);
    expect(postgresDialectAdapter.serializeValue("boolean", false)).toBe(false);
  });

  test("keeps json as object", () => {
    const value = { a: 1 };
    expect(postgresDialectAdapter.serializeValue("json", value)).toBe(value);
  });

  test("builds LIKE pattern", () => {
    expect(postgresDialectAdapter.renderLikePattern("startsWith", "ab")).toBe(
      "ab%",
    );
    expect(postgresDialectAdapter.renderLikePattern("endsWith", "ab")).toBe(
      "%ab",
    );
    expect(postgresDialectAdapter.renderLikePattern("contains", "ab")).toBe(
      "%ab%",
    );
  });
});

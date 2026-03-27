import { describe, expect, test } from "bun:test";
import { parsePostgresArrayLiteral } from "./parse-array.js";

describe("parsePostgresArrayLiteral", () => {
  test("parses simple string arrays", () => {
    const result = parsePostgresArrayLiteral('{"basic","microsoft"}');

    expect(result).toEqual(["basic", "microsoft"]);
  });

  test("parses numeric and boolean values", () => {
    const result = parsePostgresArrayLiteral("{1,2,true,false}");

    expect(result).toEqual([1, 2, true, false]);
  });

  test("parses empty arrays", () => {
    const result = parsePostgresArrayLiteral("{}");

    expect(result).toEqual([]);
  });

  test("parses escaped quotes and backslashes", () => {
    const result = parsePostgresArrayLiteral('{"a\\\\b","c\\"d"}');

    expect(result).toEqual(["a\\b", 'c"d']);
  });

  test("returns null for invalid literals", () => {
    const result = parsePostgresArrayLiteral("not-an-array");

    expect(result).toBeNull();
  });
});

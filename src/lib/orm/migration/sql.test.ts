import { describe, expect, test } from "bun:test";
import { toSqlIdentifier, toSqlIdentifierList } from "./sql.js";

describe("toSqlIdentifier", () => {
  test("accepts valid identifiers", () => {
    expect(toSqlIdentifier("users")).toBe("users");
    expect(toSqlIdentifier("users_2026")).toBe("users_2026");
    expect(toSqlIdentifier("_internal_table")).toBe("_internal_table");
  });

  test("rejects invalid identifiers", () => {
    expect(() => toSqlIdentifier("users-table")).toThrow(
      "Invalid SQL identifier",
    );
    expect(() => toSqlIdentifier("1users")).toThrow("Invalid SQL identifier");
    expect(() => toSqlIdentifier("users; DROP TABLE users; --")).toThrow(
      "Invalid SQL identifier",
    );
    expect(() => toSqlIdentifier("users name")).toThrow(
      "Invalid SQL identifier",
    );
  });
});

describe("toSqlIdentifierList", () => {
  test("maps valid identifier lists", () => {
    expect(toSqlIdentifierList(["users", "email"])).toEqual(["users", "email"]);
  });

  test("rejects when at least one identifier is invalid", () => {
    expect(() =>
      toSqlIdentifierList(["users", "email; DROP TABLE users;"]),
    ).toThrow("Invalid SQL identifier");
  });
});

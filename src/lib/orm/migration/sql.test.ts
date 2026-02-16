import { describe, expect, test } from "bun:test";
import { toSqlIdentifier, toSqlIdentifierList } from "./sql.js";

describe("toSqlIdentifier", () => {
  test("accepts valid identifiers", () => {
    const [error1, result1] = toSqlIdentifier("users");
    expect(error1).toBeNull();
    expect(result1).toBe("users");

    const [error2, result2] = toSqlIdentifier("users_2026");
    expect(error2).toBeNull();
    expect(result2).toBe("users_2026");

    const [error3, result3] = toSqlIdentifier("_internal_table");
    expect(error3).toBeNull();
    expect(result3).toBe("_internal_table");
  });

  test("rejects invalid identifiers", () => {
    const [error1] = toSqlIdentifier("users-table");
    expect(error1).not.toBeNull();
    expect(error1?.message).toContain("Invalid SQL identifier");

    const [error2] = toSqlIdentifier("1users");
    expect(error2).not.toBeNull();
    expect(error2?.message).toContain("Invalid SQL identifier");

    const [error3] = toSqlIdentifier("users; DROP TABLE users; --");
    expect(error3).not.toBeNull();
    expect(error3?.message).toContain("Invalid SQL identifier");

    const [error4] = toSqlIdentifier("users name");
    expect(error4).not.toBeNull();
    expect(error4?.message).toContain("Invalid SQL identifier");
  });
});

describe("toSqlIdentifierList", () => {
  test("maps valid identifier lists", () => {
    const [error, result] = toSqlIdentifierList(["users", "email"]);
    expect(error).toBeNull();
    expect(result).toEqual(["users", "email"]);
  });

  test("rejects when at least one identifier is invalid", () => {
    const [error] = toSqlIdentifierList(["users", "email; DROP TABLE users;"]);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("Invalid SQL identifier");
  });
});

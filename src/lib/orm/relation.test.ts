import { describe, expect, test } from "bun:test";
import { many, one } from "./relation.js";

describe("many()", () => {
  test("returns kind 'many'", () => {
    const rel = many(() => "table");
    expect(rel.kind).toBe("many");
  });

  test("stores the table factory", () => {
    const factory = () => "usersTable";
    const rel = many(factory);
    expect(rel.table).toBe(factory);
    expect(rel.table()).toBe("usersTable");
  });
});

describe("one()", () => {
  test("returns kind 'one'", () => {
    const rel = one("user_id", () => "table");
    expect(rel.kind).toBe("one");
  });

  test("stores the foreignKey", () => {
    const rel = one("assignee_id", () => "table");
    expect(rel.foreignKey).toBe("assignee_id");
  });

  test("stores the table factory", () => {
    const factory = () => "usersTable";
    const rel = one("user_id", factory);
    expect(rel.table).toBe(factory);
    expect(rel.table()).toBe("usersTable");
  });
});

import { describe, expect, test } from "bun:test";
import { boolean, json, jsonb, number, string, uuid } from "../column/index.js";
import { Table } from "../table/index.js";
import { PostgresDialect } from "./postgres.js";
import type { QueryFragment } from "./types.js";

describe("PostgresDialect - query building", () => {
  const dialect = new PostgresDialect();

  test("should use correct type mappings", () => {
    expect(dialect.types.number).toBe("INTEGER");
    expect(dialect.types.string).toBe("TEXT");
    expect(dialect.types.boolean).toBe("BOOLEAN");
    expect(dialect.types.date).toBe("TIMESTAMP");
    expect(dialect.types.json).toBe("JSON");
    expect(dialect.types.jsonb).toBe("JSONB");
    expect(dialect.types.uuid).toBe("UUID");
  });

  test("buildSelect should use $1, $2, $3 placeholders", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      where: {
        text: "age > ? AND active = ?",
        values: [18, true],
      },
    });

    expect(result.sql).toBe(
      "SELECT id, name FROM users WHERE age > $1 AND active = $2",
    );
    expect(result.params).toEqual([18, true]);
  });

  test("buildSelect should handle pagination", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      limit: 10,
      offset: 20,
    });

    expect(result.sql).toBe("SELECT id, name FROM users LIMIT 10 OFFSET 20");
    expect(result.params).toEqual([]);
  });

  test("buildSelect should handle limit only", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      limit: 10,
    });

    expect(result.sql).toBe("SELECT id, name FROM users LIMIT 10");
  });

  test("buildSelect should handle offset only", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      offset: 20,
    });

    expect(result.sql).toBe("SELECT id, name FROM users LIMIT ALL OFFSET 20");
  });

  test("buildInsert should use $1, $2, $3 placeholders", () => {
    const result = dialect.buildInsert({
      tableName: "users",
      values: { name: "Alice", age: 30 },
    });

    expect(result.sql).toBe(
      "INSERT INTO users (name, age) VALUES ($1, $2) RETURNING *",
    );
    expect(result.params).toEqual(["Alice", 30]);
  });

  test("buildUpdate should use $1, $2, $3 placeholders with correct offsets", () => {
    const where: QueryFragment = {
      text: "id = ?",
      values: [1],
    };

    const result = dialect.buildUpdate({
      tableName: "users",
      values: { name: "Bob", age: 25 },
      where,
    });

    expect(result.sql).toBe(
      "UPDATE users SET name = $1, age = $2 WHERE id = $3 RETURNING *",
    );
    expect(result.params).toEqual(["Bob", 25, 1]);
  });

  test("buildDelete should use $1, $2, $3 placeholders", () => {
    const where: QueryFragment = {
      text: "id = ?",
      values: [1],
    };

    const result = dialect.buildDelete({
      tableName: "users",
      where,
    });

    expect(result.sql).toBe("DELETE FROM users WHERE id = $1 RETURNING *");
    expect(result.params).toEqual([1]);
  });

  test("convertBooleanValue should handle native booleans", () => {
    expect(dialect.convertBooleanValue(true)).toBe(true);
    expect(dialect.convertBooleanValue(false)).toBe(false);
  });

  test("convertBooleanValue should handle truthy/falsy values", () => {
    expect(dialect.convertBooleanValue(1)).toBe(true);
    expect(dialect.convertBooleanValue(0)).toBe(false);
    expect(dialect.convertBooleanValue("yes")).toBe(true);
    expect(dialect.convertBooleanValue("")).toBe(false);
  });
});

describe("PostgresDialect - CREATE TABLE", () => {
  const dialect = new PostgresDialect();

  test("should create table with BIGSERIAL for auto-incrementing primary key", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const sql = dialect.buildCreateTable(table);
    expect(sql).toContain("id BIGSERIAL PRIMARY KEY");
    expect(sql).toContain("name TEXT NOT NULL");
  });

  test("should handle non-auto-incrementing primary keys", () => {
    const table = new Table("users", {
      uuid: uuid("uuid").primaryKey(),
      name: string("name").notNull(),
    });

    const sql = dialect.buildCreateTable(table);
    expect(sql).toContain("uuid UUID PRIMARY KEY");
    expect(sql).toContain("name TEXT NOT NULL");
  });

  test("should handle JSON and JSONB columns", () => {
    const table = new Table("documents", {
      id: number("id").primaryKey(),
      data: json("data").notNull(),
      metadata: jsonb("metadata"),
    });

    const sql = dialect.buildCreateTable(table);
    expect(sql).toContain("id BIGSERIAL PRIMARY KEY");
    expect(sql).toContain("data JSON NOT NULL");
    expect(sql).toContain("metadata JSONB");
  });

  test("should handle UUID columns", () => {
    const table = new Table("sessions", {
      id: uuid("id").primaryKey(),
      userId: uuid("user_id").notNull(),
      token: string("token").notNull(),
    });

    const sql = dialect.buildCreateTable(table);
    expect(sql).toContain("id UUID PRIMARY KEY");
    expect(sql).toContain("user_id UUID NOT NULL");
    expect(sql).toContain("token TEXT NOT NULL");
  });

  test("should handle unique constraints", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      email: string("email").unique().notNull(),
    });

    const sql = dialect.buildCreateTable(table);
    expect(sql).toContain("email TEXT NOT NULL UNIQUE");
  });

  test("should handle all column types", () => {
    const table = new Table("complex", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
      active: boolean("active").default(true),
      config: jsonb("config"),
      sessionId: uuid("session_id"),
    });

    const sql = dialect.buildCreateTable(table);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS complex");
    expect(sql).toContain("id BIGSERIAL PRIMARY KEY");
    expect(sql).toContain("name TEXT NOT NULL");
    expect(sql).toContain("active BOOLEAN DEFAULT true");
    expect(sql).toContain("config JSONB");
    expect(sql).toContain("session_id UUID");
  });
});

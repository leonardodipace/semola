import { describe, expect, test } from "bun:test";
import { boolean, json, jsonb, number, string, uuid } from "../column/index.js";
import { Table } from "../table/index.js";
import { SqliteDialect } from "./sqlite.js";
import type { QueryFragment } from "./types.js";

describe("SqliteDialect - query building", () => {
  const dialect = new SqliteDialect();

  test("should use correct type mappings", () => {
    expect(dialect.types.number).toBe("INTEGER");
    expect(dialect.types.string).toBe("TEXT");
    expect(dialect.types.boolean).toBe("INTEGER");
    expect(dialect.types.date).toBe("INTEGER");
    expect(dialect.types.json).toBe("TEXT");
    expect(dialect.types.jsonb).toBe("TEXT");
    expect(dialect.types.uuid).toBe("TEXT");
  });

  test("buildSelect should use ? placeholders", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      where: {
        text: "age > ? AND active = ?",
        values: [18, true],
      },
    });

    expect(result.sql).toBe(
      'SELECT "id", "name" FROM "users" WHERE age > ? AND active = ?',
    );
    expect(result.params).toEqual([18, true]);
  });

  test("buildSelect should handle pagination", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      limit: 10,
      offset: 20,
    });

    expect(result.sql).toBe(
      'SELECT "id", "name" FROM "users" LIMIT 10 OFFSET 20',
    );
    expect(result.params).toEqual([]);
  });

  test("buildSelect should handle limit only", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      limit: 10,
    });

    expect(result.sql).toBe('SELECT "id", "name" FROM "users" LIMIT 10');
  });

  test("buildSelect should handle offset only", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      offset: 20,
    });

    expect(result.sql).toBe(
      'SELECT "id", "name" FROM "users" LIMIT -1 OFFSET 20',
    );
  });

  test("buildInsert should use ? placeholders", () => {
    const result = dialect.buildInsert({
      tableName: "users",
      values: { name: "Alice", age: 30 },
    });

    expect(result.sql).toBe(
      'INSERT INTO "users" ("name", "age") VALUES (?, ?) RETURNING *',
    );
    expect(result.params).toEqual(["Alice", 30]);
  });

  test("buildUpdate should use ? placeholders", () => {
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
      'UPDATE "users" SET "name" = ?, "age" = ? WHERE id = ? RETURNING *',
    );
    expect(result.params).toEqual(["Bob", 25, 1]);
  });

  test("buildDelete should use ? placeholders", () => {
    const where: QueryFragment = {
      text: "id = ?",
      values: [1],
    };

    const result = dialect.buildDelete({
      tableName: "users",
      where,
    });

    expect(result.sql).toBe('DELETE FROM "users" WHERE id = ? RETURNING *');
    expect(result.params).toEqual([1]);
  });

  test("convertBooleanValue should handle SQLite integers", () => {
    expect(dialect.convertBooleanValue(1)).toBe(true);
    expect(dialect.convertBooleanValue(0)).toBe(false);
  });

  test("convertBooleanValue should handle native booleans", () => {
    expect(dialect.convertBooleanValue(true)).toBe(true);
    expect(dialect.convertBooleanValue(false)).toBe(false);
  });
});

describe("SqliteDialect - CREATE TABLE", () => {
  const dialect = new SqliteDialect();

  test("should create table with auto-incrementing primary key", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"id" INTEGER PRIMARY KEY');
    expect(sql).toContain('"name" TEXT NOT NULL');
  });

  test("should handle non-numeric primary keys", () => {
    const table = new Table("users", {
      uuid: uuid("uuid").primaryKey(),
      name: string("name").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"uuid" TEXT PRIMARY KEY');
    expect(sql).toContain('"name" TEXT NOT NULL');
  });

  test("should handle JSON columns stored as TEXT", () => {
    const table = new Table("documents", {
      id: number("id").primaryKey(),
      data: json("data").notNull(),
      metadata: jsonb("metadata"),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"id" INTEGER PRIMARY KEY');
    expect(sql).toContain('"data" TEXT NOT NULL');
    expect(sql).toContain('"metadata" TEXT');
  });

  test("should handle UUID columns stored as TEXT", () => {
    const table = new Table("sessions", {
      id: uuid("id").primaryKey(),
      userId: uuid("user_id").notNull(),
      token: string("token").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"id" TEXT PRIMARY KEY');
    expect(sql).toContain('"user_id" TEXT NOT NULL');
    expect(sql).toContain('"token" TEXT NOT NULL');
  });

  test("should handle boolean columns stored as INTEGER", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      active: boolean("active").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"active" INTEGER NOT NULL');
  });

  test("should handle unique constraints", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      email: string("email").unique().notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
  });

  test("should handle all column types", () => {
    const table = new Table("complex", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
      active: boolean("active").default(true),
      config: jsonb("config"),
      sessionId: uuid("session_id"),
    });
    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "complex"');
    expect(sql).toContain('"id" INTEGER PRIMARY KEY');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"active" INTEGER DEFAULT 1');
    expect(sql).toContain('"config" TEXT');
    expect(sql).toContain('"session_id" TEXT');
  });

  test("should not add NOT NULL for primary key (implied)", () => {
    const table = new Table("users", {
      id: number("id").primaryKey().notNull(),
    });
    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    // Should only have PRIMARY KEY, not NOT NULL twice
    expect(sql).toBe(
      'CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)',
    );
  });

  test("should not add UNIQUE for primary key (implied)", () => {
    const table = new Table("users", {
      id: number("id").primaryKey().unique(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    // Should only have PRIMARY KEY, not UNIQUE
    expect(sql).toBe(
      'CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)',
    );
  });
});

describe("SqliteDialect - pagination", () => {
  const dialect = new SqliteDialect();

  test("should build LIMIT with offset", () => {
    const result = dialect.buildPagination(10, 20);
    expect(result).toBe("LIMIT 10 OFFSET 20");
  });

  test("should build LIMIT only", () => {
    const result = dialect.buildPagination(10, undefined);
    expect(result).toBe("LIMIT 10");
  });

  test("should build OFFSET only with LIMIT -1", () => {
    const result = dialect.buildPagination(undefined, 20);
    expect(result).toBe("LIMIT -1 OFFSET 20");
  });

  test("should return null when no pagination params", () => {
    const result = dialect.buildPagination(undefined, undefined);
    expect(result).toBeNull();
  });

  test("should return null when offset is 0", () => {
    const result = dialect.buildPagination(undefined, 0);
    expect(result).toBeNull();
  });

  test("buildCreateTable returns error for unsupported column type", () => {
    const dialect = new SqliteDialect();

    // Create a table with an invalid column type for testing
    const invalidColumn = {
      sqlName: "bad_col",
      columnKind: "unsupported_type" as any,
      meta: {
        primaryKey: false,
        notNull: false,
        unique: false,
        hasDefault: false,
      },
    };

    const invalidTable = {
      sqlName: "test",
      columns: { badCol: invalidColumn },
    } as any;

    const [error, sql] = dialect.buildCreateTable(invalidTable);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("UnsupportedType");
    expect(error?.message).toContain("Unsupported column type");
    expect(error?.message).toContain("unsupported_type");
    expect(sql).toBeNull();
  });
});

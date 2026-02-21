import { describe, expect, test } from "bun:test";
import { boolean, json, jsonb, number, string, uuid } from "../column/index.js";
import { Table } from "../table/index.js";
import { SqliteDialect } from "./sqlite.js";

describe("SqliteDialect - type mappings", () => {
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
    expect(sql).toBe(
      'CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)',
    );
  });

  test("should return error for unsupported column type", () => {
    const invalidColumn = {
      sqlName: "bad_col",
      columnKind: "unsupported_type",
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
    };

    // @ts-expect-error - testing runtime handling of invalid table shape
    const [error, sql] = dialect.buildCreateTable(invalidTable);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("UnsupportedType");
    expect(error?.message).toContain("Unsupported column type");
    expect(error?.message).toContain("unsupported_type");
    expect(sql).toBeNull();
  });
});

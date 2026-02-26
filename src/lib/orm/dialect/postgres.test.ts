import { describe, expect, test } from "bun:test";
import { boolean, json, jsonb, number, string, uuid } from "../column/index.js";
import { Table } from "../table/index.js";
import { PostgresDialect } from "./postgres.js";

describe("PostgresDialect - type mappings", () => {
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

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"id" BIGSERIAL PRIMARY KEY');
    expect(sql).toContain('"name" TEXT NOT NULL');
  });

  test("should handle non-auto-incrementing primary keys", () => {
    const table = new Table("users", {
      uuid: uuid("uuid").primaryKey(),
      name: string("name").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"uuid" UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(sql).toContain('"name" TEXT NOT NULL');
  });

  test("should handle JSON and JSONB columns", () => {
    const table = new Table("documents", {
      id: number("id").primaryKey(),
      data: json("data").notNull(),
      metadata: jsonb("metadata"),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"id" BIGSERIAL PRIMARY KEY');
    expect(sql).toContain('"data" JSON NOT NULL');
    expect(sql).toContain('"metadata" JSONB');
  });

  test("should handle UUID columns", () => {
    const table = new Table("sessions", {
      id: uuid("id").primaryKey(),
      userId: uuid("user_id").notNull(),
      token: string("token").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain('"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(sql).toContain('"user_id" UUID NOT NULL');
    expect(sql).toContain('"token" TEXT NOT NULL');
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
    expect(sql).toContain('"id" BIGSERIAL PRIMARY KEY');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"active" BOOLEAN DEFAULT true');
    expect(sql).toContain('"config" JSONB');
    expect(sql).toContain('"session_id" UUID');
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

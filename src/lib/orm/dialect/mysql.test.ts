import { describe, expect, test } from "bun:test";
import { boolean, json, jsonb, number, string, uuid } from "../column/index.js";
import { Table } from "../table/index.js";
import { MysqlDialect } from "./mysql.js";

describe("MysqlDialect - type mappings", () => {
  const dialect = new MysqlDialect();

  test("should use correct type mappings", () => {
    expect(dialect.types.number).toBe("INT");
    expect(dialect.types.string).toBe("VARCHAR(255)");
    expect(dialect.types.boolean).toBe("BOOLEAN");
    expect(dialect.types.date).toBe("DATETIME");
    expect(dialect.types.json).toBe("JSON");
    expect(dialect.types.jsonb).toBe("JSON");
    expect(dialect.types.uuid).toBe("CHAR(36)");
  });

  test("convertBooleanValue should handle native booleans", () => {
    expect(dialect.convertBooleanValue(true)).toBe(true);
    expect(dialect.convertBooleanValue(false)).toBe(false);
  });

  test("convertBooleanValue should handle MySQL integers", () => {
    expect(dialect.convertBooleanValue(1)).toBe(true);
    expect(dialect.convertBooleanValue(0)).toBe(false);
  });

  test("convertBooleanValue should handle truthy/falsy values", () => {
    expect(dialect.convertBooleanValue("yes")).toBe(true);
    expect(dialect.convertBooleanValue("")).toBe(false);
  });
});

describe("MysqlDialect - CREATE TABLE", () => {
  const dialect = new MysqlDialect();

  test("should create table with BIGINT AUTO_INCREMENT for auto-incrementing primary key", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain("`id` BIGINT AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("`name` VARCHAR(255) NOT NULL");
  });

  test("should handle non-auto-incrementing primary keys", () => {
    const table = new Table("users", {
      uuid: uuid("uuid").primaryKey(),
      name: string("name").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain("`uuid` CHAR(36) PRIMARY KEY DEFAULT (UUID())");
    expect(sql).toContain("`name` VARCHAR(255) NOT NULL");
  });

  test("should handle JSON columns", () => {
    const table = new Table("documents", {
      id: number("id").primaryKey(),
      data: json("data").notNull(),
      metadata: jsonb("metadata"),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain("`id` BIGINT AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("`data` JSON NOT NULL");
    expect(sql).toContain("`metadata` JSON");
  });

  test("should handle UUID columns stored as CHAR(36)", () => {
    const table = new Table("sessions", {
      id: uuid("id").primaryKey(),
      userId: uuid("user_id").notNull(),
      token: string("token").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain("`id` CHAR(36) PRIMARY KEY DEFAULT (UUID())");
    expect(sql).toContain("`user_id` CHAR(36) NOT NULL");
    expect(sql).toContain("`token` VARCHAR(255) NOT NULL");
  });

  test("should handle boolean columns", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      active: boolean("active").notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain("`active` BOOLEAN NOT NULL");
  });

  test("should handle unique constraints", () => {
    const table = new Table("users", {
      id: number("id").primaryKey(),
      email: string("email").unique().notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toContain("`email` VARCHAR(255) NOT NULL UNIQUE");
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
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `complex`");
    expect(sql).toContain("`id` BIGINT AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("`name` VARCHAR(255) NOT NULL");
    expect(sql).toContain("`active` BOOLEAN DEFAULT 1");
    expect(sql).toContain("`config` JSON");
    expect(sql).toContain("`session_id` CHAR(36)");
  });

  test("should not add NOT NULL for primary key (implied)", () => {
    const table = new Table("users", {
      id: number("id").primaryKey().notNull(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toBe(
      "CREATE TABLE IF NOT EXISTS `users` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY)",
    );
  });

  test("should not add UNIQUE for primary key (implied)", () => {
    const table = new Table("users", {
      id: number("id").primaryKey().unique(),
    });

    const [error, sql] = dialect.buildCreateTable(table);
    expect(error).toBeNull();
    expect(sql).toBe(
      "CREATE TABLE IF NOT EXISTS `users` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY)",
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

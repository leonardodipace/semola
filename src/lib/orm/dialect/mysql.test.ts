import { describe, expect, test } from "bun:test";
import { boolean, json, jsonb, number, string, uuid } from "../column/index.js";
import { Table } from "../table/index.js";
import { MysqlDialect } from "./mysql.js";
import type { QueryFragment } from "./types.js";

describe("MysqlDialect - query building", () => {
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

  test("buildSelect should use ? placeholders", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      where: {
        text: "age > ? AND active = ?",
        values: [18, true],
      },
    });

    expect(result.sql).toBe(
      "SELECT `id`, `name` FROM `users` WHERE age > ? AND active = ?",
    );
    expect(result.params).toEqual([18, true]);
  });

  test("buildSelect should handle pagination", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      limit: 10,
      offset: 20,
    });

    expect(result.sql).toBe(
      "SELECT `id`, `name` FROM `users` LIMIT 10 OFFSET 20",
    );
    expect(result.params).toEqual([]);
  });

  test("buildSelect should handle limit only", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      limit: 10,
    });

    expect(result.sql).toBe("SELECT `id`, `name` FROM `users` LIMIT 10");
  });

  test("buildSelect should handle offset only", () => {
    const result = dialect.buildSelect("users", ["id", "name"], {
      offset: 20,
    });

    expect(result.sql).toBe(
      "SELECT `id`, `name` FROM `users` LIMIT 18446744073709551615 OFFSET 20",
    );
  });

  test("buildInsert should use ? placeholders", () => {
    const result = dialect.buildInsert({
      tableName: "users",
      values: { name: "Alice", age: 30 },
    });

    expect(result.sql).toBe(
      "INSERT INTO `users` (`name`, `age`) VALUES (?, ?)",
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
      "UPDATE `users` SET `name` = ?, `age` = ? WHERE id = ?",
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

    expect(result.sql).toBe("DELETE FROM `users` WHERE id = ?");
    expect(result.params).toEqual([1]);
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
    expect(sql).toContain("`uuid` CHAR(36) PRIMARY KEY");
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
    expect(sql).toContain("`id` CHAR(36) PRIMARY KEY");
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
    // Should only have PRIMARY KEY, not NOT NULL twice
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
    // Should only have PRIMARY KEY, not UNIQUE
    expect(sql).toBe(
      "CREATE TABLE IF NOT EXISTS `users` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY)",
    );
  });
});

describe("MysqlDialect - pagination", () => {
  const dialect = new MysqlDialect();

  test("should build LIMIT with offset", () => {
    const result = dialect.buildPagination(10, 20);
    expect(result).toBe("LIMIT 10 OFFSET 20");
  });

  test("should build LIMIT only", () => {
    const result = dialect.buildPagination(10, undefined);
    expect(result).toBe("LIMIT 10");
  });

  test("should build OFFSET only", () => {
    const result = dialect.buildPagination(undefined, 20);
    expect(result).toBe("LIMIT 18446744073709551615 OFFSET 20");
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
    const dialect = new MysqlDialect();

    // Create a table with an invalid column type for testing
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

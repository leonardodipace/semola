import { describe, expect, test } from "bun:test";
import { boolean, Column, date, number, string } from "./index.js";

describe("Column - builders", () => {
  test("number should create a number column", () => {
    const col = number("id");
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("id");
  });

  test("string should create a string column", () => {
    const col = string("name");
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("name");
  });

  test("boolean should create a boolean column", () => {
    const col = boolean("active");
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("active");
  });

  test("date should create a date column", () => {
    const col = date("created_at");
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("created_at");
  });
});

describe("Column - modifiers", () => {
  test("primaryKey should mark column as primary key", () => {
    const col = number("id").primaryKey();
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("id");
  });

  test("notNull should mark column as not null", () => {
    const col = string("name").notNull();
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("name");
  });

  test("unique should mark column as unique", () => {
    const col = string("email").unique();
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("email");
  });

  test("default should set default value", () => {
    const col = boolean("active").default(true);
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("active");
  });

  test("modifiers should be chainable", () => {
    const col = string("email").unique().notNull();
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("email");
  });

  test("multiple modifiers should create new instances", () => {
    const base = number("id");
    const withPk = base.primaryKey();
    const withNotNull = base.notNull();

    // Each modifier returns a new instance
    expect(base).not.toBe(withPk);
    expect(base).not.toBe(withNotNull);
    expect(withPk).not.toBe(withNotNull);

    // Original sqlName is preserved
    expect(base.sqlName).toBe("id");
    expect(withPk.sqlName).toBe("id");
    expect(withNotNull.sqlName).toBe("id");
  });

  test("complex chaining", () => {
    const col = number("user_id").notNull().default(0);
    expect(col).toBeInstanceOf(Column);
    expect(col.sqlName).toBe("user_id");
  });

  test("hasDefault should be true for falsy defaults", () => {
    const zeroDefault = number("count").default(0);
    const falseDefault = boolean("active").default(false);
    const emptyDefault = string("name").default("");

    expect(zeroDefault.meta.hasDefault).toBe(true);
    expect(falseDefault.meta.hasDefault).toBe(true);
    expect(emptyDefault.meta.hasDefault).toBe(true);
  });
});

describe("Column - SQL name mapping", () => {
  test("should preserve SQL column name with underscores", () => {
    const col = string("created_at");
    expect(col.sqlName).toBe("created_at");
  });

  test("should handle camelCase SQL names", () => {
    const col = string("createdAt");
    expect(col.sqlName).toBe("createdAt");
  });

  test("should handle mixed case", () => {
    const col = string("user_ID");
    expect(col.sqlName).toBe("user_ID");
  });
});

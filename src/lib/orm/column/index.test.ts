import { describe, expect, test } from "bun:test";
import { boolean, date, number, string, uuid } from "./index.js";

describe("ORM column builders", () => {
  test("create the expected base column metadata", () => {
    const text = string("email");
    const numeric = number("score");
    const bool = boolean("is_active");
    const datetime = date("created_at");
    const id = uuid("id");

    expect(text.type).toBe("string");
    expect(text.sqlName).toBe("email");
    expect(text._meta.isNullable).toBe(true);

    expect(numeric.type).toBe("number");
    expect(bool.type).toBe("boolean");
    expect(datetime.type).toBe("date");
    expect(id.type).toBe("string");
  });

  test("set nullability and keep builders immutable", () => {
    const base = string("name");
    const required = base.notNull();
    const nullableAgain = required.nullable();

    expect(base._meta.isNullable).toBe(true);
    expect(required._meta.isNullable).toBe(false);
    expect(nullableAgain._meta.isNullable).toBe(true);
  });

  test("supports chaining primaryKey, unique, and default", () => {
    const idColumn = uuid("id").primaryKey();
    const emailColumn = string("email").notNull().unique();
    const createdAtColumn = date("created_at").default(() => new Date());

    expect(typeof idColumn.primaryKey).toBe("function");
    expect(idColumn._meta.isNullable).toBe(false);
    expect(idColumn._meta.isPrimaryKey).toBe(true);
    expect(typeof emailColumn.unique).toBe("function");
    expect(createdAtColumn._meta.hasDefault).toBeTrue();
  });

  test("does not reopen primary key columns via nullable()", () => {
    const idColumn = uuid("id").primaryKey().nullable();

    expect(idColumn._meta.isPrimaryKey).toBe(true);
    expect(idColumn._meta.isNullable).toBe(false);
  });

  test("carry references metadata after calling references()", () => {
    const usersId = uuid("id").primaryKey();
    const authorId = uuid("author_id")
      .notNull()
      .references(() => usersId);
    const referencedColumn = authorId.references.tableColumn?.();

    expect(referencedColumn?.sqlName).toBe("id");
  });
});

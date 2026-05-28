import { describe, expect, test } from "bun:test";
import {
  boolean,
  date,
  enumType,
  json,
  jsonb,
  number,
  string,
  uuid,
} from "./index.js";

describe("ORM column builders", () => {
  test("create the expected base column metadata", () => {
    const text = string("email");
    const numeric = number("score");
    const bool = boolean("is_active");
    const datetime = date("created_at");
    const id = uuid("id");
    const status = enumType("status", ["active", "inactive"]);

    expect(text.type).toBe("string");
    expect(text.sqlName).toBe("email");
    expect(text._meta.isNullable).toBe(true);

    expect(numeric.type).toBe("number");
    expect(bool.type).toBe("boolean");
    expect(datetime.type).toBe("date");
    expect(id.type).toBe("string");
    expect(status.type).toBe("enum");
    expect(status.enumValues).toEqual(["active", "inactive"]);
  });

  test("json and jsonb builders create expected column metadata", () => {
    const meta = json("meta");
    const extra = jsonb("extra");

    expect(meta.type).toBe("json");
    expect(meta.sqlName).toBe("meta");
    expect(meta._meta.isNullable).toBe(true);

    expect(extra.type).toBe("jsonb");
    expect(extra.sqlName).toBe("extra");
  });

  test("json column supports default, notNull, and nullable chaining", () => {
    type Meta = { isActive: boolean };

    const col = json<Meta>("meta")
      .notNull()
      .default(() => ({ isActive: true }));

    expect(col._meta.isNullable).toBe(false);
    expect(col._meta.hasDefault).toBe(true);
    expect(col._default?.()).toEqual({ isActive: true });
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
    const statusColumn = enumType("status", ["active", "inactive"]).default(
      () => "active",
    );

    expect(typeof idColumn.primaryKey).toBe("function");
    expect(idColumn._meta.isNullable).toBe(false);
    expect(idColumn._meta.isPrimaryKey).toBe(true);
    expect(typeof emailColumn.unique).toBe("function");
    expect(createdAtColumn._meta.hasDefault).toBeTrue();
    expect(statusColumn._meta.hasDefault).toBeTrue();
    expect(statusColumn._default?.()).toBe("active");
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

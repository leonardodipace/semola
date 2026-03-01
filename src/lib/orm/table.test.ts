import { describe, expect, test } from "bun:test";
import { string, uuid } from "./column.js";
import { createTable, Table } from "./table.js";

const columns = {
  id: uuid("id").primaryKey(),
  firstName: string("first_name").notNull(),
  email: string("email").notNull().unique(),
  bio: string("bio"),
};

describe("Table", () => {
  test("createTable helper creates a Table instance", () => {
    const table = createTable("users", columns);
    expect(table).toBeInstanceOf(Table);
    expect(table.tableName).toBe("users");
  });

  test("stores tableName", () => {
    const table = new Table("users", columns);
    expect(table.tableName).toBe("users");
  });

  test("stores columns by JS key", () => {
    const table = new Table("users", columns);
    expect(table.columns.id).toBe(columns.id);
    expect(table.columns.firstName).toBe(columns.firstName);
    expect(table.columns.email).toBe(columns.email);
    expect(table.columns.bio).toBe(columns.bio);
  });

  test("column sqlName is preserved", () => {
    const table = new Table("users", columns);
    expect(table.columns.firstName.meta.sqlName).toBe("first_name");
    expect(table.columns.email.meta.sqlName).toBe("email");
  });

  test("column meta is preserved", () => {
    const table = new Table("users", columns);
    expect(table.columns.id.meta.isPrimaryKey).toBe(true);
    expect(table.columns.firstName.meta.isNotNull).toBe(true);
    expect(table.columns.email.meta.isUnique).toBe(true);
    expect(table.columns.bio.meta.isNotNull).toBe(false);
  });
});

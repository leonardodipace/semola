import { describe, expect, test } from "bun:test";
import { uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { getDialect } from "./index.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
});

describe("getDialect", () => {
  test("returns sqlite dialect for sqlite adapter", () => {
    const dialect = getDialect({
      adapter: "sqlite",
      table: usersTable,
      relations: {},
    });

    expect(dialect.name).toBe("sqlite");
  });

  test("returns postgres dialect for postgres adapter", () => {
    const dialect = getDialect({
      adapter: "postgres",
      table: usersTable,
      relations: {},
    });

    expect(dialect.name).toBe("postgres");
  });

  test("throws for unsupported adapters", () => {
    const adapter = "mysql";

    expect(() =>
      // @ts-expect-error - testing runtime guard for values outside the Adapter type
      getDialect({ adapter, table: usersTable, relations: {} }),
    ).toThrow("Unsupported adapter: mysql");
  });
});

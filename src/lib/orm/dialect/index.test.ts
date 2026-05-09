import { describe, expect, test } from "bun:test";
import { uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { getDialect } from "./index.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
});

describe("getDialect", () => {
  test("returns sqlite dialect for sqlite adapter", () => {
    const dialect = getDialect("sqlite", usersTable, {});

    expect(dialect.name).toBe("sqlite");
  });

  test("throws for unsupported adapters", () => {
    const adapter = "postgres";

    expect(() => getDialect(adapter, usersTable, {})).toThrow(
      "Unsupported adapter: postgres",
    );
  });
});

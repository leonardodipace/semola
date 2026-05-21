import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { defineTable } from "./index.js";

describe("defineTable", () => {
  test("returns a table definition with sqlName and columns", () => {
    const columns = {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    };

    const table = defineTable("users", columns);

    expect(table.sqlName).toBe("users");
    expect(table.columns).toBe(columns);
    expect(table.columns.id.sqlName).toBe("id");
    expect(table.columns.name.sqlName).toBe("name");
  });
});

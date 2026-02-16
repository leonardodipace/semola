import { describe, expect, test } from "bun:test";
import { boolean, number, string } from "../column/index.js";
import { Table } from "../table/index.js";
import { generateMigrationSource } from "./generator.js";

describe("generateMigrationSource", () => {
  test("renders createTable and addColumn operations", () => {
    const users = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const source = generateMigrationSource(
      [
        { type: "createTable", table: users },
        {
          type: "addColumn",
          tableName: "users",
          column: boolean("active").notNull().default(false),
        },
      ],
      [
        {
          type: "dropColumn",
          tableName: "users",
          columnName: "active",
        },
      ],
    );

    expect(source).toContain('import { defineMigration } from "semola/orm"');
    expect(source).toContain("export default defineMigration({");
    expect(source).toContain('await t.createTable("users", (table) => {');
    expect(source).toContain('table.number("id").primaryKey();');
    expect(source).toContain('table.string("name").notNull();');
    expect(source).toContain('await t.addColumn("users", (table) => {');
    expect(source).toContain(
      'table.boolean("active").notNull().default(false);',
    );
    expect(source).toContain('await t.dropColumn("users", "active");');
  });

  test("renders no-op comments for empty diff", () => {
    const source = generateMigrationSource([], []);

    expect(source).toContain("// No schema changes detected");
    expect(source).toContain("// No rollback operations generated");
  });

  test("renders dropTable in rollback", () => {
    const source = generateMigrationSource(
      [],
      [{ type: "dropTable", tableName: "users" }],
    );

    expect(source).toContain('await t.dropTable("users");');
  });
});

import { describe, expect, test } from "bun:test";
import { generateMigrationSource } from "./generator.js";
import type { ColumnSnapshot, TableSnapshot } from "./snapshot.js";

describe("generateMigrationSource", () => {
  test("renders createTable and addColumn operations", () => {
    const usersSnapshot: TableSnapshot = {
      name: "users",
      columns: {
        id: {
          name: "id",
          type: "number",
          primaryKey: true,
          notNull: false,
          unique: false,
          hasDefault: false,
        },
        name: {
          name: "name",
          type: "string",
          primaryKey: false,
          notNull: true,
          unique: false,
          hasDefault: false,
        },
      },
    };

    const activeColumn: ColumnSnapshot = {
      name: "active",
      type: "boolean",
      primaryKey: false,
      notNull: true,
      unique: false,
      hasDefault: true,
      defaultValue: false,
    };

    const source = generateMigrationSource(
      [
        { type: "createTable", tableSnapshot: usersSnapshot },
        {
          type: "addColumn",
          tableName: "users",
          columnSnapshot: activeColumn,
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

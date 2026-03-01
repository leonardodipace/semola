import { describe, expect, test } from "bun:test";
import { diffSnapshots } from "./diff.js";
import type { SchemaSnapshot } from "./types.js";

function snapshot(tables: SchemaSnapshot["tables"]): SchemaSnapshot {
  return {
    dialect: "postgres",
    tables,
  };
}

describe("diffSnapshots", () => {
  test("detects create table", () => {
    const operations = diffSnapshots(
      snapshot({}),
      snapshot({
        users: {
          key: "users",
          tableName: "users",
          columns: {
            id: {
              key: "id",
              sqlName: "id",
              kind: "uuid",
              isPrimaryKey: true,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: null,
              referencesColumn: null,
              onDeleteAction: null,
            },
          },
        },
      }),
    );

    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe("create-table");
  });

  test("detects changed columns as drop+add", () => {
    const before = snapshot({
      users: {
        key: "users",
        tableName: "users",
        columns: {
          email: {
            key: "email",
            sqlName: "email",
            kind: "string",
            isPrimaryKey: false,
            isNotNull: false,
            isUnique: false,
            hasDefault: false,
            referencesTable: null,
            referencesColumn: null,
            onDeleteAction: null,
          },
        },
      },
    });

    const after = snapshot({
      users: {
        key: "users",
        tableName: "users",
        columns: {
          email: {
            key: "email",
            sqlName: "email",
            kind: "string",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: true,
            hasDefault: false,
            referencesTable: null,
            referencesColumn: null,
            onDeleteAction: null,
          },
        },
      },
    });

    const operations = diffSnapshots(before, after);
    expect(operations).toHaveLength(2);
    expect(operations[0]?.kind).toBe("drop-column");
    expect(operations[1]?.kind).toBe("add-column");
  });

  test("keeps literal default metadata on added columns", () => {
    const before = snapshot({
      users: {
        key: "users",
        tableName: "users",
        columns: {
          id: {
            key: "id",
            sqlName: "id",
            kind: "uuid",
            isPrimaryKey: true,
            isNotNull: true,
            isUnique: false,
            hasDefault: false,
            referencesTable: null,
            referencesColumn: null,
            onDeleteAction: null,
          },
        },
      },
    });

    const after = snapshot({
      users: {
        key: "users",
        tableName: "users",
        columns: {
          id: {
            key: "id",
            sqlName: "id",
            kind: "uuid",
            isPrimaryKey: true,
            isNotNull: true,
            isUnique: false,
            hasDefault: false,
            referencesTable: null,
            referencesColumn: null,
            onDeleteAction: null,
          },
          meta: {
            key: "meta",
            sqlName: "meta",
            kind: "json",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: false,
            hasDefault: true,
            defaultKind: "value",
            defaultValue: { level: 0 },
            referencesTable: null,
            referencesColumn: null,
            onDeleteAction: null,
          },
        },
      },
    });

    const operations = diffSnapshots(before, after);
    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe("add-column");

    if (operations[0]?.kind !== "add-column") {
      return;
    }

    expect(operations[0].column.defaultKind).toBe("value");
    expect(operations[0].column.defaultValue).toEqual({ level: 0 });
  });
});

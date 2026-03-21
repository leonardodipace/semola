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

  test("orders create-table operations by foreign key dependency", () => {
    const operations = diffSnapshots(
      snapshot({}),
      snapshot({
        tasks: {
          key: "tasks",
          tableName: "tasks",
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
            assigneeId: {
              key: "assigneeId",
              sqlName: "assignee_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "users",
              referencesColumn: "id",
              onDeleteAction: "CASCADE",
            },
          },
        },
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

    const createTables = operations.filter((op) => op.kind === "create-table");

    expect(createTables).toHaveLength(2);
    expect(createTables[0]?.kind).toBe("create-table");
    expect(createTables[1]?.kind).toBe("create-table");

    if (createTables[0]?.kind !== "create-table") {
      return;
    }

    if (createTables[1]?.kind !== "create-table") {
      return;
    }

    expect(createTables[0].table.tableName).toBe("users");
    expect(createTables[1].table.tableName).toBe("tasks");
  });

  test("orders drop-table operations by foreign key dependency", () => {
    const operations = diffSnapshots(
      snapshot({
        tasks: {
          key: "tasks",
          tableName: "tasks",
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
            assigneeId: {
              key: "assigneeId",
              sqlName: "assignee_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "users",
              referencesColumn: "id",
              onDeleteAction: "CASCADE",
            },
          },
        },
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
      snapshot({}),
    );

    const dropTables = operations.filter((op) => op.kind === "drop-table");

    expect(dropTables).toHaveLength(2);
    expect(dropTables[0]?.kind).toBe("drop-table");
    expect(dropTables[1]?.kind).toBe("drop-table");

    if (dropTables[0]?.kind !== "drop-table") {
      return;
    }

    if (dropTables[1]?.kind !== "drop-table") {
      return;
    }

    expect(dropTables[0].table.tableName).toBe("tasks");
    expect(dropTables[1].table.tableName).toBe("users");
  });

  test("detects foreign key target changes as drop+add", () => {
    const before = snapshot({
      tasks: {
        key: "tasks",
        tableName: "tasks",
        columns: {
          assigneeId: {
            key: "assigneeId",
            sqlName: "assignee_id",
            kind: "uuid",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: false,
            hasDefault: false,
            referencesTable: "users",
            referencesColumn: "id",
            onDeleteAction: "CASCADE",
          },
        },
      },
    });

    const after = snapshot({
      tasks: {
        key: "tasks",
        tableName: "tasks",
        columns: {
          assigneeId: {
            key: "assigneeId",
            sqlName: "assignee_id",
            kind: "uuid",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: false,
            hasDefault: false,
            referencesTable: "members",
            referencesColumn: "id",
            onDeleteAction: "CASCADE",
          },
        },
      },
    });

    const operations = diffSnapshots(before, after);

    expect(operations).toHaveLength(2);
    expect(operations[0]?.kind).toBe("drop-column");
    expect(operations[1]?.kind).toBe("add-column");
  });

  test("detects foreign key onDelete changes as drop+add", () => {
    const before = snapshot({
      tasks: {
        key: "tasks",
        tableName: "tasks",
        columns: {
          assigneeId: {
            key: "assigneeId",
            sqlName: "assignee_id",
            kind: "uuid",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: false,
            hasDefault: false,
            referencesTable: "users",
            referencesColumn: "id",
            onDeleteAction: "RESTRICT",
          },
        },
      },
    });

    const after = snapshot({
      tasks: {
        key: "tasks",
        tableName: "tasks",
        columns: {
          assigneeId: {
            key: "assigneeId",
            sqlName: "assignee_id",
            kind: "uuid",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: false,
            hasDefault: false,
            referencesTable: "users",
            referencesColumn: "id",
            onDeleteAction: "CASCADE",
          },
        },
      },
    });

    const operations = diffSnapshots(before, after);

    expect(operations).toHaveLength(2);
    expect(operations[0]?.kind).toBe("drop-column");
    expect(operations[1]?.kind).toBe("add-column");
  });

  test("keeps function-default columns unchanged", () => {
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
            hasDefault: true,
            defaultKind: "fn",
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
            hasDefault: true,
            defaultKind: "fn",
            referencesTable: null,
            referencesColumn: null,
            onDeleteAction: null,
          },
        },
      },
    });

    const operations = diffSnapshots(before, after);

    expect(operations).toHaveLength(0);
  });

  test("detects date default changes", () => {
    const before = snapshot({
      users: {
        key: "users",
        tableName: "users",
        columns: {
          createdAt: {
            key: "createdAt",
            sqlName: "created_at",
            kind: "date",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: false,
            hasDefault: true,
            defaultKind: "value",
            defaultValue: new Date("2024-01-01T00:00:00.000Z"),
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
          createdAt: {
            key: "createdAt",
            sqlName: "created_at",
            kind: "date",
            isPrimaryKey: false,
            isNotNull: true,
            isUnique: false,
            hasDefault: true,
            defaultKind: "value",
            defaultValue: new Date("2024-02-01T00:00:00.000Z"),
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

  test("detects undefined default metadata changes", () => {
    const before = snapshot({
      users: {
        key: "users",
        tableName: "users",
        columns: {
          flags: {
            key: "flags",
            sqlName: "flags",
            kind: "json",
            isPrimaryKey: false,
            isNotNull: false,
            isUnique: false,
            hasDefault: true,
            defaultKind: "value",
            defaultValue: undefined,
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
          flags: {
            key: "flags",
            sqlName: "flags",
            kind: "json",
            isPrimaryKey: false,
            isNotNull: false,
            isUnique: false,
            hasDefault: true,
            defaultKind: "value",
            defaultValue: null,
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

  test("keeps create-table order deterministic for cycles", () => {
    const operations = diffSnapshots(
      snapshot({}),
      snapshot({
        b: {
          key: "b",
          tableName: "b",
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
            aId: {
              key: "aId",
              sqlName: "a_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "a",
              referencesColumn: "id",
              onDeleteAction: "CASCADE",
            },
          },
        },
        a: {
          key: "a",
          tableName: "a",
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
            bId: {
              key: "bId",
              sqlName: "b_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "b",
              referencesColumn: "id",
              onDeleteAction: "CASCADE",
            },
          },
        },
      }),
    );

    const createTables = operations.filter((op) => op.kind === "create-table");

    expect(createTables).toHaveLength(2);
    expect(createTables[0]?.kind).toBe("create-table");
    expect(createTables[1]?.kind).toBe("create-table");

    if (createTables[0]?.kind !== "create-table") {
      return;
    }

    if (createTables[1]?.kind !== "create-table") {
      return;
    }

    expect(createTables[0].table.tableName).toBe("a");
    expect(createTables[1].table.tableName).toBe("b");
  });

  test("places drop-column operations before create-table operations", () => {
    const operations = diffSnapshots(
      snapshot({
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
      }),
      snapshot({
        users: {
          key: "users",
          tableName: "users",
          columns: {},
        },
        teams: {
          key: "teams",
          tableName: "teams",
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

    expect(operations).toHaveLength(2);
    expect(operations[0]?.kind).toBe("drop-column");
    expect(operations[1]?.kind).toBe("create-table");
  });
});

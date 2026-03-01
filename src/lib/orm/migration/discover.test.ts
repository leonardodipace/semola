import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { string, uuid } from "../column.js";
import { Table } from "../table.js";
import { buildSchemaSnapshot, loadOrmFromSchema } from "./discover.js";

describe("loadOrmFromSchema", () => {
  test("loads orm-like default export", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-discover-"));
    await mkdir(join(cwd, "src", "db"), { recursive: true });

    const schemaPath = join(cwd, "src", "db", "index.ts");
    await Bun.write(
      schemaPath,
      [
        "export default {",
        "  options: { url: 'sqlite::memory:' },",
        "  dialect: 'sqlite',",
        "  tables: {},",
        "};",
        "",
      ].join("\n"),
    );

    const [error, orm] = await loadOrmFromSchema(schemaPath);
    expect(error).toBeNull();
    expect(orm?.options.url).toBe("sqlite::memory:");
  });

  test("returns error when no orm-like export exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-discover-no-orm-"));
    const schemaPath = join(cwd, "schema.ts");

    await Bun.write(schemaPath, "export default { value: 1 };\n");

    const [error, result] = await loadOrmFromSchema(schemaPath);

    expect(result).toBeNull();
    expect(error?.message).toContain("Could not find an Orm instance");
  });

  test("loads ORM from createOrm client export", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-discover-client-"));
    await mkdir(join(cwd, "src", "db"), { recursive: true });

    const schemaPath = join(cwd, "src", "db", "index.ts");
    const ormModulePath = join(import.meta.dir, "..", "index.ts");

    await Bun.write(
      schemaPath,
      [
        `import { createOrm, createTable, uuid } from '${ormModulePath}';`,
        "",
        "const users = createTable('users', {",
        "  id: uuid('id').primaryKey(),",
        "});",
        "",
        "export const db = createOrm({",
        "  url: 'sqlite::memory:',",
        "  tables: { users },",
        "});",
        "",
      ].join("\n"),
    );

    const [error, orm] = await loadOrmFromSchema(schemaPath);
    expect(error).toBeNull();
    expect(orm?.dialect).toBe("sqlite");
    expect(Object.keys(orm?.tables ?? {})).toContain("users");
    expect(orm?.options.url).toBe("sqlite::memory:");
  });
});

describe("buildSchemaSnapshot", () => {
  test("captures references between tables", () => {
    const usersTable = new Table("users", {
      id: uuid("id").primaryKey(),
      email: string("email").notNull().unique(),
    });

    const tasksTable = new Table("tasks", {
      id: uuid("id").primaryKey(),
      assigneeId: uuid("assignee_id")
        .notNull()
        .references(() => usersTable.columns.id)
        .onDelete("CASCADE"),
    });

    const snapshot = buildSchemaSnapshot({
      dialect: "postgres",
      tables: {
        users: usersTable,
        tasks: tasksTable,
      },
    });

    const assignee = snapshot.tables.tasks?.columns.assigneeId;
    expect(assignee?.referencesTable).toBe("users");
    expect(assignee?.referencesColumn).toBe("id");
    expect(assignee?.onDeleteAction).toBe("CASCADE");
  });

  test("captures literal defaults", () => {
    const usersTable = new Table("users", {
      id: uuid("id").primaryKey(),
      meta: string("meta").default('{"level":0}').notNull(),
    });

    const snapshot = buildSchemaSnapshot({
      dialect: "postgres",
      tables: { users: usersTable },
    });

    const meta = snapshot.tables.users?.columns.meta;
    expect(meta?.hasDefault).toBe(true);
    expect(meta?.defaultKind).toBe("value");
    expect(meta?.defaultValue).toBe('{"level":0}');
  });
});

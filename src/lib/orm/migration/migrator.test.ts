import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { number, string } from "../column/index.js";
import { Orm } from "../core/index.js";
import { Table } from "../table/index.js";
import {
  applyMigrations,
  createMigration,
  getMigrationStatus,
  rollbackMigration,
} from "./migrator.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "semola-migrations-"));
  tempDirs.push(dir);
  return dir;
};

describe("Migration runtime functions", () => {
  test("create generates migration file with defineMigration default export", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    const users = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: { users },
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    const [error, filePath] = await createMigration({
      ...migrationOptions,
      name: "create users",
      tables: { users },
    });

    expect(error).toBeNull();
    expect(filePath).toBeDefined();
    expect(filePath).toContain("create_users.ts");

    if (!filePath) {
      throw new Error("filePath is undefined");
    }

    const source = await Bun.file(filePath).text();
    expect(source).toContain('import { defineMigration } from "semola/orm"');
    expect(source).toContain("export default defineMigration({");
    expect(source).toContain("up: async (t) => {");
    expect(source).toContain("down: async (t) => {");

    orm.close();
  });

  test("apply and rollback execute default-export migration", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    await Bun.write(
      `${migrationsDir}/20260216120000_create_users.ts`,
      `export default {
  up: async (t) => {
    await t.createTable("users", (table) => {
      table.number("id").primaryKey();
      table.string("name").notNull();
    });
  },
  down: async (t) => {
    await t.dropTable("users");
  },
};
`,
    );

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    const [appliedError, applied] = await applyMigrations(migrationOptions);
    expect(appliedError).toBeNull();
    expect(applied).toEqual(["20260216120000"]);

    const rows = await orm.sql.unsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(Array.isArray(rows) && rows.length > 0).toBe(true);

    const [rollbackError, rolledBack] =
      await rollbackMigration(migrationOptions);
    expect(rollbackError).toBeNull();
    expect(rolledBack).toBe("20260216120000");

    const rowsAfter = await orm.sql.unsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
    expect(Array.isArray(rowsAfter)).toBe(true);
    expect(Array.isArray(rowsAfter) && rowsAfter.length).toBe(0);

    orm.close();
  });

  test("status marks applied migrations", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    await Bun.write(
      `${migrationsDir}/20260216120000_create_users.ts`,
      `export default {
  up: async (t) => {
    await t.raw("SELECT 1");
  },
  down: async (t) => {
    await t.raw("SELECT 1");
  },
};
`,
    );

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    await applyMigrations(migrationOptions);
    const [statusError, status] = await getMigrationStatus(migrationOptions);

    expect(statusError).toBeNull();
    expect(status).toBeDefined();
    expect(status?.length).toBe(1);
    expect(status?.[0]?.version).toBe("20260216120000");
    expect(status?.[0]?.applied).toBe(true);

    orm.close();
  });

  test("create returns error when migration name is empty after slugify", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    const users = new Table("users", {
      id: number("id").primaryKey(),
    });

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: { users },
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    const [error, _filePath] = await createMigration({
      ...migrationOptions,
      name: "___---",
      tables: { users },
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Migration name cannot be empty");

    orm.close();
  });

  test("create sanitizes malicious migration name into safe filename", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    const users = new Table("users", {
      id: number("id").primaryKey(),
    });

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: { users },
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    const [filePathError, filePath] = await createMigration({
      ...migrationOptions,
      name: "../DROP TABLE users; -- add@email!!",
      tables: { users },
    });

    expect(filePathError).toBeNull();
    expect(filePath).toBeDefined();
    expect(filePath?.includes("..")).toBe(false);
    expect(filePath?.includes("/DROP")).toBe(false);
    expect(filePath?.endsWith("drop_table_users_add_email.ts")).toBe(true);

    orm.close();
  });

  test("apply skips already-applied migrations", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    await Bun.write(
      `${migrationsDir}/20260216120000_first.ts`,
      `export default {
  up: async (t) => {
    await t.raw("SELECT 1");
  },
  down: async (t) => {
    await t.raw("SELECT 1");
  },
};
`,
    );

    await Bun.write(
      `${migrationsDir}/20260216120100_second.ts`,
      `export default {
  up: async (t) => {
    await t.raw("SELECT 2");
  },
  down: async (t) => {
    await t.raw("SELECT 2");
  },
};
`,
    );

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    const [firstError, firstApplied] = await applyMigrations(migrationOptions);
    expect(firstError).toBeNull();
    expect(firstApplied).toEqual(["20260216120000", "20260216120100"]);

    const [secondError, secondApplied] =
      await applyMigrations(migrationOptions);
    expect(secondError).toBeNull();
    expect(secondApplied).toEqual([]);

    orm.close();
  });

  test("rollback returns null when no migrations were applied", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    const [error, rolledBack] = await rollbackMigration(migrationOptions);
    expect(error).toBeNull();
    expect(rolledBack).toBeNull();

    orm.close();
  });

  test("rollback returns error when migration record exists but file is missing", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    await Bun.write(
      `${migrationsDir}/20260216120000_first.ts`,
      `export default {
  up: async (t) => {
    await t.raw("SELECT 1");
  },
  down: async (t) => {
    await t.raw("SELECT 1");
  },
};
`,
    );

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    await applyMigrations(migrationOptions);
    await rm(`${migrationsDir}/20260216120000_first.ts`);

    const [error] = await rollbackMigration(migrationOptions);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("Missing migration file for version");

    orm.close();
  });

  test("apply returns error for invalid migration default export", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    await Bun.write(
      `${migrationsDir}/20260216120000_invalid.ts`,
      `export default { up: async () => {} };`,
    );

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    const [error] = await applyMigrations(migrationOptions);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("default export must be defineMigration");

    orm.close();
  });

  test("status shows pending and applied migrations", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    await Bun.write(
      `${migrationsDir}/20260216120000_first.ts`,
      `export default {
  up: async (t) => {
    await t.raw("SELECT 1");
  },
  down: async (t) => {
    await t.raw("SELECT 1");
  },
};
`,
    );

    await Bun.write(
      `${migrationsDir}/20260216120100_second.ts`,
      `export default {
  up: async (t) => {
    await t.raw("SELECT 2");
  },
  down: async (t) => {
    await t.raw("SELECT 2");
  },
};
`,
    );

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const migrationOptions = {
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
    };

    await orm.sql.unsafe(
      "CREATE TABLE IF NOT EXISTS semola_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    await orm.sql.unsafe(
      "INSERT INTO semola_migrations (version, name, applied_at) VALUES ('20260216120000', 'first', '2026-02-16T12:00:00.000Z')",
    );

    const [error, statuses] = await getMigrationStatus(migrationOptions);

    expect(error).toBeNull();
    expect(statuses).toBeDefined();
    expect(statuses?.length).toBe(2);
    expect(statuses?.[0]?.version).toBe("20260216120000");
    expect(statuses?.[0]?.applied).toBe(true);
    expect(statuses?.[1]?.version).toBe("20260216120100");
    expect(statuses?.[1]?.applied).toBe(false);

    orm.close();
  });
});

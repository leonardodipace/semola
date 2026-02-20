import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
import { getAppliedMigrations } from "./state.js";

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

  test("create generates unique, lexically ordered versions for same timestamp", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    const users = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const posts = new Table("posts", {
      id: number("id").primaryKey(),
    });

    const comments = new Table("comments", {
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

    const [firstError, firstPath] = await createMigration({
      ...migrationOptions,
      name: "initial",
      tables: { users },
    });

    expect(firstError).toBeNull();
    expect(firstPath).toBeDefined();

    const [secondError, secondPath] = await createMigration({
      ...migrationOptions,
      name: "add posts",
      tables: { users, posts },
    });

    expect(secondError).toBeNull();
    expect(secondPath).toBeDefined();

    const [thirdError, thirdPath] = await createMigration({
      ...migrationOptions,
      name: "add comments",
      tables: { users, posts, comments },
    });

    expect(thirdError).toBeNull();
    expect(thirdPath).toBeDefined();

    expect(firstPath).not.toBe(secondPath);
    expect(secondPath).not.toBe(thirdPath);

    const [scanError, files] = await getMigrationStatus(migrationOptions);
    expect(scanError).toBeNull();
    expect(files?.length).toBe(3);

    const versions = files?.map((item) => item.version) ?? [];
    expect(versions[0] && /^\d{20}$/.test(versions[0])).toBe(true);
    expect(versions[1] && /^\d{20}$/.test(versions[1])).toBe(true);
    expect(versions[2] && /^\d{20}$/.test(versions[2])).toBe(true);
    expect(versions[0] && versions[1] && versions[0] < versions[1]).toBe(true);
    expect(versions[1] && versions[2] && versions[1] < versions[2]).toBe(true);

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
    if (!Array.isArray(rows)) {
      throw new Error("Expected rows to be an array");
    }
    expect(rows.length).toBeGreaterThan(0);

    const [rollbackError, rolledBack] =
      await rollbackMigration(migrationOptions);
    expect(rollbackError).toBeNull();
    expect(rolledBack).toBe("20260216120000");

    const rowsAfter = await orm.sql.unsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
    expect(Array.isArray(rowsAfter)).toBe(true);
    if (!Array.isArray(rowsAfter)) {
      throw new Error("Expected rowsAfter to be an array");
    }
    expect(rowsAfter.length).toBe(0);

    await orm.close();
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
    await mkdir(migrationsDir);

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

  test("createMigration rolls back on snapshot write failure", async () => {
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

    // Create initial migration to establish first snapshot
    await createMigration({
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
      name: "initial",
      tables: { users },
    });

    // Now try to create second migration with invalid meta directory
    // This will fail when trying to write snapshot
    const metaDir = join(migrationsDir, "meta");
    await rm(metaDir, { recursive: true, force: true });
    await Bun.write(metaDir, "not-a-directory-but-a-file");

    const [error, filePath] = await createMigration({
      orm,
      migrationsDir,
      migrationTable: "semola_migrations",
      name: "second",
      tables: {
        users,
        posts: new Table("posts", {
          id: number("id").primaryKey(),
        }),
      },
    });

    // Verify error is returned
    expect(error).not.toBeNull();
    expect(error?.message).toContain("Failed to create migration directories");

    // Verify no migration file was created (compensating rollback)
    expect(filePath).toBeNull();

    orm.close();
  });

  test("applyMigrations rolls back transaction on migration.up failure", async () => {
    const dir = await createTempDir();
    const migrationsDir = join(dir, "migrations");

    // Create a migration that will fail during up()
    await Bun.write(
      `${migrationsDir}/20260216120000_failing.ts`,
      `export default {
  up: async (t) => {
    await t.createTable("users", (table) => {
      table.number("id").primaryKey();
    });
    // This will throw an error
    throw new Error("Simulated migration failure");
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

    // Apply migrations - should fail
    const [error, applied] = await applyMigrations(migrationOptions);

    // Verify error is returned
    expect(error).not.toBeNull();
    expect(error?.message).toContain("Failed to apply migration");
    expect(error?.message).toContain("Simulated migration failure");
    expect(applied).toBeNull();

    // Verify transaction was rolled back - table should not exist
    const rows = await orm.sql.unsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
    expect(Array.isArray(rows)).toBe(true);
    if (!Array.isArray(rows)) {
      throw new Error("Expected rows to be an array");
    }
    expect(rows.length).toBe(0);

    // Verify no migration recorded in state table
    const [, migrations] = await getAppliedMigrations(
      orm,
      migrationOptions.migrationTable,
    );
    expect(migrations?.length).toBe(0);

    await orm.close();
  });

  test("createMigration returns error when directory creation fails", async () => {
    const invalidDir = "/invalid/nonexistent/path/that/cannot/be/created";

    const users = new Table("users", {
      id: number("id").primaryKey(),
    });

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: { users },
    });

    const [error, filePath] = await createMigration({
      orm,
      migrationsDir: invalidDir,
      migrationTable: "semola_migrations",
      name: "test",
      tables: { users },
    });

    // Verify error is returned
    expect(error).not.toBeNull();
    expect(error?.type).toBe("InternalServerError");
    expect(error?.message).toContain("Failed to create migration directories");

    // Verify no file path returned
    expect(filePath).toBeNull();

    orm.close();
  });
});

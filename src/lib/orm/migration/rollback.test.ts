import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "./apply.js";
import { rollbackMigration } from "./rollback.js";

async function setupProject() {
  const cwd = await mkdtemp(join(tmpdir(), "semola-rollback-"));
  const databaseUrl = `sqlite:${join(cwd, "migration-rollback.db")}`;

  await mkdir(join(cwd, "src", "db"), { recursive: true });
  await Bun.write(
    join(cwd, "semola.config.ts"),
    [
      "export default {",
      "  orm: {",
      "    schema: './src/db/index.ts',",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await Bun.write(
    join(cwd, "src", "db", "index.ts"),
    [
      "export default {",
      `  options: { url: '${databaseUrl}' },`,
      "  dialect: 'sqlite',",
      "  tables: {},",
      "};",
      "",
    ].join("\n"),
  );

  return {
    cwd,
    databaseUrl,
  };
}

async function readAppliedDirectories(databaseUrl: string) {
  const sql = new SQL(databaseUrl);

  try {
    await sql.unsafe(
      "CREATE TABLE IF NOT EXISTS _semola_migrations (" +
        "directory_name TEXT PRIMARY KEY," +
        "migration_id TEXT NOT NULL," +
        "migration_name TEXT NOT NULL," +
        "applied_at TEXT NOT NULL" +
        ")",
    );

    const rows = await sql.unsafe(
      "SELECT directory_name FROM _semola_migrations ORDER BY applied_at ASC, directory_name ASC",
    );

    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => {
        if (!row || typeof row !== "object") {
          return null;
        }

        const directoryName = Reflect.get(row, "directory_name");

        if (typeof directoryName !== "string") {
          return null;
        }

        return directoryName;
      })
      .filter((value) => value !== null);
  } finally {
    await sql.close();
  }
}

describe("rollbackMigration", () => {
  test("returns message when no applied migrations exist", async () => {
    const project = await setupProject();

    const result = await rollbackMigration({ cwd: project.cwd });

    expect(result.rolledBack).toBe(false);
    if (result.rolledBack) {
      return;
    }
    expect(result.message).toContain("No applied migrations found");
  });

  test("rolls back last applied migration and updates state", async () => {
    const project = await setupProject();
    const migrationDir = join(
      project.cwd,
      "migrations",
      "20260228231146001_init",
    );

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(join(migrationDir, "up.sql"), "SELECT 1;\n");
    await Bun.write(
      join(migrationDir, "down.sql"),
      "DROP TABLE IF EXISTS users;\n",
    );

    await applyMigrations({ cwd: project.cwd });

    const result = await rollbackMigration({ cwd: project.cwd });
    expect(result.rolledBack).toBe(true);
    if (!result.rolledBack) {
      return;
    }
    expect(result.migrationId).toBe("20260228231146001");

    const appliedDirectories = await readAppliedDirectories(
      project.databaseUrl,
    );
    expect(appliedDirectories).toHaveLength(0);
  });

  test("rolls back migration with explicit transaction statements", async () => {
    const project = await setupProject();
    const migrationDir = join(
      project.cwd,
      "migrations",
      "20260326221500000_rebuild",
    );

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(join(migrationDir, "up.sql"), "SELECT 1;\n");
    await Bun.write(
      join(migrationDir, "down.sql"),
      [
        "PRAGMA foreign_keys = OFF;",
        "BEGIN IMMEDIATE;",
        "SELECT 1;",
        "COMMIT;",
        "PRAGMA foreign_keys = ON;",
        "",
      ].join("\n"),
    );

    await applyMigrations({ cwd: project.cwd });

    const result = await rollbackMigration({ cwd: project.cwd });

    expect(result.rolledBack).toBe(true);

    const appliedDirectories = await readAppliedDirectories(
      project.databaseUrl,
    );
    expect(appliedDirectories).toHaveLength(0);
  });

  test("rolls back latest directory when applied migrations share id prefix", async () => {
    const project = await setupProject();

    const firstDir = join(
      project.cwd,
      "migrations",
      "20260326221500000_00_init",
    );
    const secondDir = join(
      project.cwd,
      "migrations",
      "20260326221500000_01_add_email",
    );

    await mkdir(firstDir, { recursive: true });
    await mkdir(secondDir, { recursive: true });

    await Bun.write(
      join(firstDir, "up.sql"),
      "CREATE TABLE users (id TEXT);\n",
    );
    await Bun.write(
      join(firstDir, "down.sql"),
      "DROP TABLE IF EXISTS users;\n",
    );
    await Bun.write(
      join(secondDir, "up.sql"),
      "CREATE TABLE profiles (id TEXT);\n",
    );
    await Bun.write(
      join(secondDir, "down.sql"),
      "DROP TABLE IF EXISTS profiles;\n",
    );

    await applyMigrations({ cwd: project.cwd });

    const result = await rollbackMigration({ cwd: project.cwd });

    expect(result.rolledBack).toBe(true);
    if (!result.rolledBack) {
      return;
    }

    expect(result.migrationId).toBe("20260326221500000");
    expect(result.migrationName).toBe("01_add_email");

    const appliedDirectories = await readAppliedDirectories(
      project.databaseUrl,
    );

    expect(appliedDirectories).toHaveLength(1);
    expect(appliedDirectories[0]).toBe("20260326221500000_00_init");
  });
});

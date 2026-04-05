import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "./apply.js";

async function setupProject() {
  const cwd = await mkdtemp(join(tmpdir(), "semola-apply-"));
  const databaseUrl = `sqlite:${join(cwd, "migration-apply.db")}`;

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

describe("applyMigrations", () => {
  test("returns no pending when migrations folder is empty", async () => {
    const project = await setupProject();

    const result = await applyMigrations({ cwd: project.cwd });

    expect(result.pending).toBe(0);
    expect(result.total).toBe(0);
    expect(result.trackerTable).toBe("_semola_migrations");
  });

  test("applies pending migration and writes migration tracker row", async () => {
    const project = await setupProject();
    const migrationDir = join(
      project.cwd,
      "migrations",
      "20260228231146001_init",
    );

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(
      join(migrationDir, "up.sql"),
      "CREATE TABLE users (id TEXT PRIMARY KEY);\n",
    );
    await Bun.write(
      join(migrationDir, "down.sql"),
      "DROP TABLE IF EXISTS users;\n",
    );

    const result = await applyMigrations({ cwd: project.cwd });
    expect(result.applied).toBe(1);
    expect(result.total).toBe(1);

    const appliedDirectories = await readAppliedDirectories(
      project.databaseUrl,
    );
    expect(appliedDirectories).toEqual(["20260228231146001_init"]);
  });

  test("applies migration with explicit transaction statements", async () => {
    const project = await setupProject();
    const migrationDir = join(
      project.cwd,
      "migrations",
      "20260326221500000_rebuild",
    );

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(
      join(migrationDir, "up.sql"),
      [
        "PRAGMA foreign_keys = OFF;",
        "BEGIN IMMEDIATE;",
        "CREATE TABLE users (id TEXT PRIMARY KEY);",
        "COMMIT;",
        "PRAGMA foreign_keys = ON;",
        "",
      ].join("\n"),
    );
    await Bun.write(
      join(migrationDir, "down.sql"),
      "DROP TABLE IF EXISTS users;\n",
    );

    const result = await applyMigrations({ cwd: project.cwd });
    expect(result.applied).toBe(1);
    expect(result.total).toBe(1);
  });

  test("marks only successful migrations when a later migration fails", async () => {
    const project = await setupProject();

    const firstDir = join(project.cwd, "migrations", "20260326221500000_init");
    const secondDir = join(
      project.cwd,
      "migrations",
      "20260326221600000_add_email",
    );

    await mkdir(firstDir, { recursive: true });
    await mkdir(secondDir, { recursive: true });

    await Bun.write(
      join(firstDir, "up.sql"),
      [
        "CREATE TABLE users (id TEXT PRIMARY KEY);",
        "INSERT INTO users (id) VALUES ('u1');",
        "",
      ].join("\n"),
    );
    await Bun.write(join(firstDir, "down.sql"), "DROP TABLE users;\n");

    await Bun.write(
      join(secondDir, "up.sql"),
      ["ALTER TABLE users ADD COLUMN email TEXT NOT NULL;", ""].join("\n"),
    );
    await Bun.write(
      join(secondDir, "down.sql"),
      "ALTER TABLE users DROP COLUMN email;\n",
    );

    await expect(applyMigrations({ cwd: project.cwd })).rejects.toThrow();

    const appliedDirectories = await readAppliedDirectories(
      project.databaseUrl,
    );

    expect(appliedDirectories).toHaveLength(1);
    expect(appliedDirectories[0]).toBe("20260326221500000_init");
  });

  test("does not mark a failing first migration as applied", async () => {
    const project = await setupProject();
    const migrationDir = join(
      project.cwd,
      "migrations",
      "20260326221700000_broken",
    );

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(
      join(migrationDir, "up.sql"),
      ["CREATE TABLE users (id TEXT PRIMARY KEY);", "BROKEN SQL;", ""].join(
        "\n",
      ),
    );
    await Bun.write(
      join(migrationDir, "down.sql"),
      "DROP TABLE IF EXISTS users;\n",
    );

    await expect(applyMigrations({ cwd: project.cwd })).rejects.toThrow();

    const appliedDirectories = await readAppliedDirectories(
      project.databaseUrl,
    );
    expect(appliedDirectories).toHaveLength(0);
  });

  test("applies both migrations when two directories share the same id prefix", async () => {
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
      "CREATE TABLE users (id TEXT PRIMARY KEY);\n",
    );
    await Bun.write(join(firstDir, "down.sql"), "DROP TABLE users;\n");

    await Bun.write(
      join(secondDir, "up.sql"),
      "ALTER TABLE users ADD COLUMN email TEXT;\n",
    );
    await Bun.write(
      join(secondDir, "down.sql"),
      "ALTER TABLE users DROP COLUMN email;\n",
    );

    const result = await applyMigrations({ cwd: project.cwd });

    expect(result.applied).toBe(2);
    expect(result.total).toBe(2);

    const appliedDirectories = await readAppliedDirectories(
      project.databaseUrl,
    );

    expect(appliedDirectories).toHaveLength(2);
    expect(appliedDirectories[0]).toBe("20260326221500000_00_init");
    expect(appliedDirectories[1]).toBe("20260326221500000_01_add_email");
  });
});

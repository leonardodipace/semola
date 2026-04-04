import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "./apply.js";

async function setupProject() {
  const cwd = await mkdtemp(join(tmpdir(), "semola-apply-"));
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
      "  options: { url: 'sqlite::memory:' },",
      "  dialect: 'sqlite',",
      "  tables: {},",
      "};",
      "",
    ].join("\n"),
  );
  return cwd;
}

describe("applyMigrations", () => {
  test("returns no pending when migrations folder is empty", async () => {
    const cwd = await setupProject();

    const result = await applyMigrations({ cwd });

    expect(result.pending).toBe(0);
    expect(result.total).toBe(0);
  });

  test("applies pending migration and writes state file", async () => {
    const cwd = await setupProject();
    const migrationDir = join(cwd, "migrations", "20260228231146001_init");

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(
      join(migrationDir, "up.sql"),
      "CREATE TABLE users (id TEXT PRIMARY KEY);\n",
    );
    await Bun.write(
      join(migrationDir, "down.sql"),
      "DROP TABLE IF EXISTS users;\n",
    );

    const result = await applyMigrations({ cwd });
    expect(result.applied).toBe(1);
    expect(result.total).toBe(1);

    const stateFile = join(cwd, ".semola-migrations.json");
    const exists = await Bun.file(stateFile).exists();
    expect(exists).toBe(true);

    const state = JSON.parse(await Bun.file(stateFile).text()) as {
      applied: Array<{ id: string }>;
    };
    expect(state.applied[0]?.id).toBe("20260228231146001");
  });

  test("applies migration with explicit transaction statements", async () => {
    const cwd = await setupProject();
    const migrationDir = join(cwd, "migrations", "20260326221500000_rebuild");

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(
      join(migrationDir, "up.sql"),
      [
        "PRAGMA foreign_keys = OFF;",
        "BEGIN;",
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

    const result = await applyMigrations({ cwd });
    expect(result.applied).toBe(1);
    expect(result.total).toBe(1);
  });

  test("marks only successful migrations when a later migration fails", async () => {
    const cwd = await setupProject();

    const firstDir = join(cwd, "migrations", "20260326221500000_init");
    const secondDir = join(cwd, "migrations", "20260326221600000_add_email");

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

    await expect(applyMigrations({ cwd })).rejects.toThrow();

    const stateFile = join(cwd, ".semola-migrations.json");
    const state = JSON.parse(await Bun.file(stateFile).text()) as {
      applied: Array<{ id: string }>;
    };

    expect(state.applied).toHaveLength(1);
    expect(state.applied[0]?.id).toBe("20260326221500000");
  });

  test("does not mark a failing first migration as applied", async () => {
    const cwd = await setupProject();
    const migrationDir = join(cwd, "migrations", "20260326221700000_broken");

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

    await expect(applyMigrations({ cwd })).rejects.toThrow();

    const stateFile = join(cwd, ".semola-migrations.json");
    const exists = await Bun.file(stateFile).exists();

    if (!exists) {
      expect(exists).toBe(false);
      return;
    }

    const state = JSON.parse(await Bun.file(stateFile).text()) as {
      applied: Array<{ id: string }>;
    };

    expect(state.applied).toHaveLength(0);
  });
});

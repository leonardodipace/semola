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

    const [error, result] = await applyMigrations({ cwd });

    expect(error).toBeNull();
    expect(result?.pending).toBe(0);
    expect(result?.total).toBe(0);
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

    const [error, result] = await applyMigrations({ cwd });
    expect(error).toBeNull();
    expect(result?.applied).toBe(1);
    expect(result?.total).toBe(1);

    const stateFile = join(cwd, ".semola-migrations.json");
    const exists = await Bun.file(stateFile).exists();
    expect(exists).toBe(true);

    const state = JSON.parse(await Bun.file(stateFile).text()) as {
      applied: Array<{ id: string }>;
    };
    expect(state.applied[0]?.id).toBe("20260228231146001");
  });
});

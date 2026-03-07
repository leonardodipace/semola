import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rollbackMigration } from "./rollback.js";

async function setupProject() {
  const cwd = await mkdtemp(join(tmpdir(), "semola-rollback-"));
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

describe("rollbackMigration", () => {
  test("returns message when no applied migrations exist", async () => {
    const cwd = await setupProject();

    const [error, result] = await rollbackMigration({ cwd });

    expect(error).toBeNull();
    expect(result?.rolledBack).toBe(false);
    if (result?.rolledBack) {
      return;
    }
    expect(result?.message).toContain("No applied migrations found");
  });

  test("rolls back last applied migration and updates state", async () => {
    const cwd = await setupProject();
    const migrationDir = join(cwd, "migrations", "20260228231146001_init");

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(join(migrationDir, "up.sql"), "SELECT 1;\n");
    await Bun.write(
      join(migrationDir, "down.sql"),
      "DROP TABLE IF EXISTS users;\n",
    );

    await Bun.write(
      join(cwd, ".semola-migrations.json"),
      JSON.stringify(
        {
          applied: [
            {
              id: "20260228231146001",
              appliedAt: "2026-02-28T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );

    const [error, result] = await rollbackMigration({ cwd });
    expect(error).toBeNull();
    expect(result?.rolledBack).toBe(true);
    if (!result?.rolledBack) {
      return;
    }
    expect(result.migrationId).toBe("20260228231146001");

    const state = JSON.parse(
      await Bun.file(join(cwd, ".semola-migrations.json")).text(),
    ) as { applied: unknown[] };
    expect(state.applied).toHaveLength(0);
  });
});

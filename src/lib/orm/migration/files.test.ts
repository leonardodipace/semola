import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMigrations } from "./files.js";

describe("listMigrations", () => {
  test("returns migration directories from migrations folder", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-files-"));
    const migrationsDir = join(cwd, "migrations");
    const migrationDir = join(migrationsDir, "20260228231146001_init");

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(join(migrationDir, "up.sql"), "SELECT 1;");
    await Bun.write(join(migrationDir, "down.sql"), "SELECT 1;");

    const migrations = await listMigrations(migrationsDir);
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.id).toBe("20260228231146001");
    expect(migrations[0]?.name).toBe("init");
  });
});

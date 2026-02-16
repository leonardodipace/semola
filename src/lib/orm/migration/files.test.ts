import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMigration, scanMigrationFiles } from "./files.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "semola-migration-files-"));
  tempDirs.push(dir);
  return dir;
};

describe("scanMigrationFiles", () => {
  test("returns empty list when directory does not exist", async () => {
    const files = await scanMigrationFiles("/tmp/semola-not-existing-dir");
    expect(files).toEqual([]);
  });

  test("filters invalid names and sorts by version", async () => {
    const dir = await createTempDir();

    await Bun.write(join(dir, "README.md"), "ignore");
    await Bun.write(join(dir, "bad_name.ts"), "ignore");
    await Bun.write(join(dir, "20260216120100_second.ts"), "");
    await Bun.write(join(dir, "20260216120000_first.ts"), "");

    const files = await scanMigrationFiles(dir);

    expect(files.length).toBe(2);
    expect(files[0]?.version).toBe("20260216120000");
    expect(files[0]?.name).toBe("first");
    expect(files[1]?.version).toBe("20260216120100");
    expect(files[1]?.name).toBe("second");
  });
});

describe("loadMigration", () => {
  test("loads migration with default export up/down", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "20260216120000_valid.ts");

    await Bun.write(
      filePath,
      `export default {
  up: async () => {},
  down: async () => {},
};
`,
    );

    const migration = await loadMigration({
      version: "20260216120000",
      name: "valid",
      filePath,
    });

    expect(migration.version).toBe("20260216120000");
    expect(migration.name).toBe("valid");
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
  });

  test("throws when default export does not match migration shape", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "20260216120000_invalid.ts");

    await Bun.write(
      filePath,
      `export default {
  up: async () => {},
};
`,
    );

    await expect(
      loadMigration({
        version: "20260216120000",
        name: "invalid",
        filePath,
      }),
    ).rejects.toThrow("default export must be defineMigration({ up, down })");
  });
});

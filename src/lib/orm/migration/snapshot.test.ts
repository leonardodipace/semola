import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSnapshot,
  readSnapshot,
  type SchemaSnapshot,
  writeSnapshot,
} from "./snapshot.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "semola-snapshot-"));
  tempDirs.push(dir);
  return dir;
};

describe("readSnapshot", () => {
  test("returns null when file does not exist", async () => {
    const [error, snapshot] = await readSnapshot(
      "/tmp/non-existent-snapshot.json",
    );

    expect(error).toBeNull();
    expect(snapshot).toBeNull();
  });

  test("returns error for invalid snapshot format", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-snapshot.json");
    await Bun.write(tempFile, JSON.stringify({ invalid: "format" }));

    const [error, snapshot] = await readSnapshot(tempFile);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("Invalid snapshot format");
    expect(snapshot).toBeNull();
  });

  test("returns error for invalid JSON", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-snapshot.json");
    await Bun.write(tempFile, "{ invalid json }");

    const [error, snapshot] = await readSnapshot(tempFile);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("InternalServerError");
    expect(snapshot).toBeNull();
  });

  test("returns valid snapshot when file is valid", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-snapshot.json");
    const validSnapshot: SchemaSnapshot = {
      version: 1,
      dialect: "postgres",
      tables: {
        users: {
          name: "users",
          columns: {
            id: {
              name: "id",
              type: "number",
              primaryKey: true,
              notNull: true,
              unique: false,
              hasDefault: false,
            },
          },
        },
      },
    };
    await Bun.write(tempFile, JSON.stringify(validSnapshot));

    const [error, snapshot] = await readSnapshot(tempFile);

    expect(error).toBeNull();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.dialect).toBe("postgres");
    expect(snapshot?.tables.users).toBeDefined();
  });
});

describe("writeSnapshot", () => {
  test("writes snapshot successfully", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-snapshot.json");
    const snapshot: SchemaSnapshot = {
      version: 1,
      dialect: "postgres",
      tables: {},
    };

    const [error, result] = await writeSnapshot(tempFile, snapshot);

    expect(error).toBeNull();
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);

    const file = Bun.file(tempFile);
    expect(await file.exists()).toBe(true);
  });

  test("returns error tuple on failure", async () => {
    const [error, result] = await writeSnapshot("/invalid/path/snapshot.json", {
      version: 1,
      dialect: "postgres",
      tables: {},
    });

    expect(error).not.toBeNull();
    expect(result).toBeNull();
  });
});

describe("createSnapshot", () => {
  test("creates empty snapshot for no tables", () => {
    const snapshot = createSnapshot({}, "postgres");

    expect(snapshot.version).toBe(1);
    expect(snapshot.dialect).toBe("postgres");
    expect(snapshot.tables).toEqual({});
  });
});

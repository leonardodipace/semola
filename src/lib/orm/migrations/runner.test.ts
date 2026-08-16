import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { string, uuid } from "../column/index.js";
import { MigrationError } from "../errors.js";
import { createOrm } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import {
  applyMigrations,
  createMigration,
  loadConfig,
  rollbackMigration,
} from "./index.js";

describe("orm migrations runner", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const setupProject = async (dbPath: string) => {
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);

    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
    });

    const schemaPath = join(root, "db.ts");
    const configPath = join(root, "semola.config.ts");
    const migrationsDir = join(root, "migrations");

    await writeFile(
      schemaPath,
      `
import { createOrm, defineTable, string, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").notNull().unique(),
});

export const db = createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbPath)},
  tables: { users },
});
`,
    );

    await writeFile(
      configPath,
      `
import { defineConfig } from ${JSON.stringify(join(import.meta.dir, "../../config.ts"))};

export default defineConfig({
  orm: {
    schema: "./db.ts",
    migrationsDir: "./migrations",
  },
});
`,
    );

    await mkdir(migrationsDir, { recursive: true });

    return {
      root,
      users,
      migrationsDir,
      dbPath,
    };
  };

  test("create, apply, and rollback", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    const folder = await createMigration({
      name: "initialize_database",
      config,
    });

    expect(folder).toContain("initialize_database");

    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();
    const down = await Bun.file(
      join(project.migrationsDir, folder, "down.sql"),
    ).text();

    expect(up).toContain('CREATE TABLE "users"');
    expect(down).toContain('DROP TABLE "users"');

    const applied = await applyMigrations(config);

    expect(applied).toEqual([folder]);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    await db.users.create({
      data: { id: "1", name: "Ada", email: "ada@example.com" },
    });

    const user = await db.users.findFirst({
      where: { email: "ada@example.com" },
    });

    expect(user?.name).toBe("Ada");

    const rolled = await rollbackMigration(config);

    expect(rolled).toBe(folder);

    await expect(
      db.users.findFirst({ where: { email: "ada@example.com" } }),
    ).rejects.toThrow();

    await db.$raw.close();
  });

  test("fails create when pending migrations exist", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });

    await expect(createMigration({ name: "second", config })).rejects.toThrow(
      MigrationError,
    );
  });

  test("fails create when schema unchanged", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    await expect(createMigration({ name: "noop", config })).rejects.toThrow(
      MigrationError,
    );
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { string, uuid } from "../column/index.js";
import { MigrationError } from "../errors.js";
import {
  PG_ID,
  PG_ID_2,
  resetPostgres,
  SEMOLA_POSTGRES_URL,
} from "../integration-helpers.js";
import { createOrm } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import {
  applyMigrations,
  createMigration,
  loadConfig,
  rollbackMigration,
} from "./index.js";
import { decodeSchemaHeader } from "./sql.js";
import { createMigrationProject } from "./test-project.js";

describe("sqlite migrations integration", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const setupProject = (
    dbUrl: string,
    adapter: "sqlite" | "postgres" = "sqlite",
  ) => createMigrationProject(dirs, dbUrl, adapter);

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

  test("loadConfig uses the real database url, not the redacted $config url", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    expect(config.orm.url).toBe(dbFile);
    expect(config.orm.adapter).toBe("sqlite");
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

  test("sqlite recreate copies existing rows", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    await db.users.create({
      data: { id: "1", name: "Ada", email: "ada@example.com" },
    });

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull().dbDefault("anon"),
      email: string("email").notNull().unique(),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const folder = await createMigration({
      name: "name_default",
      config: nextConfig,
    });
    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();

    expect(up).toContain("INSERT INTO");

    await applyMigrations(nextConfig);

    const user = await db.users.findFirst({
      where: { email: "ada@example.com" },
    });

    expect(user?.name).toBe("Ada");

    await db.$raw.close();
  });

  test("rejects apply when the schema header is missing", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = join(project.migrationsDir, "20240101000000_broken");

    await mkdir(folder);
    await writeFile(
      join(folder, "up.sql"),
      'CREATE TABLE "users" (id TEXT);\n',
    );

    await expect(applyMigrations(config)).rejects.toThrow(
      "missing a schema header",
    );

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const tables = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
      )),
    ];

    expect(tables).toHaveLength(0);

    await db.$raw.close();
  });

  test("rejects apply when up.sql has a header but no SQL", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = join(project.migrationsDir, "20240101000000_empty_body");

    await mkdir(folder);
    await writeFile(
      join(folder, "up.sql"),
      `-- semola-schema:${JSON.stringify({ tables: {} })}
`,
    );

    await expect(applyMigrations(config)).rejects.toThrow(
      "has no SQL statements to apply",
    );
  });

  test("applies defaults that contain semicolons", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      note: string("note").notNull().dbDefault("a;b"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };

    await createMigration({ name: "note_default", config: nextConfig });
    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });

    await db.$raw.unsafe(
      `INSERT INTO users (id, name, email) VALUES ('1', 'Ada', 'ada@example.com')`,
    );

    const user = await db.users.findFirst({
      where: { email: "ada@example.com" },
    });

    expect(user?.note).toBe("a;b");

    await db.$raw.close();
  });

  test("applies defaults with escaped quotes and comment semicolons", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      note: string("note").notNull().dbDefault("it's"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const folder = await createMigration({
      name: "escaped_quote",
      config: nextConfig,
    });
    const upPath = join(project.migrationsDir, folder, "up.sql");
    const up = await Bun.file(upPath).text();

    await writeFile(
      upPath,
      up.replace("\n\n", "\n-- keep ; in comments\n/* also ; in blocks */\n\n"),
    );
    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });

    await db.$raw.unsafe(
      `INSERT INTO users (id, name, email) VALUES ('1', 'Ada', 'ada@example.com')`,
    );

    const user = await db.users.findFirst({
      where: { email: "ada@example.com" },
    });

    expect(user?.note).toBe("it's");

    await db.$raw.close();
  });

  test("rejects apply when history does not match files", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);
    await mkdir(join(project.migrationsDir, "00000000000000_gap"));

    await expect(applyMigrations(config)).rejects.toThrow(
      "does not match files",
    );
  });

  test("rejects apply when up.sql is missing", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await rm(join(project.migrationsDir, folder, "up.sql"));

    await expect(applyMigrations(config)).rejects.toThrow("Could not read");
  });

  test("apply is a no-op when nothing is pending", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    expect(await applyMigrations(config)).toEqual([]);
  });

  test("rollback fails when no migrations are applied", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await expect(rollbackMigration(config)).rejects.toThrow(
      "No migrations to rollback",
    );
  });

  test("rejects an empty migration name", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await expect(createMigration({ name: "???", config })).rejects.toThrow(
      "Invalid migration name",
    );
  });

  test("loadConfig fails when semola.config.ts is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);

    await expect(loadConfig(root)).rejects.toThrow(
      "Could not load semola.config.ts",
    );
  });

  test("loadConfig fails when the schema module has no ORM client", async () => {
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);

    await writeFile(join(root, "db.ts"), "export const nope = 1;\n");
    await writeFile(
      join(root, "semola.config.ts"),
      `
import { defineConfig } from ${JSON.stringify(join(import.meta.dir, "../../config.ts"))};

export default defineConfig({
  orm: { schema: "./db.ts" },
});
`,
    );

    await expect(loadConfig(root)).rejects.toThrow(
      "Schema module must export a createOrm() client",
    );
  });

  test("rejects apply when an applied migration folder is missing", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await applyMigrations(config);
    await rm(join(project.migrationsDir, folder), {
      recursive: true,
      force: true,
    });

    await expect(applyMigrations(config)).rejects.toThrow(
      "missing from the migrations directory",
    );
  });

  test("rejects rollback when down.sql is missing", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await applyMigrations(config);
    await rm(join(project.migrationsDir, folder, "down.sql"));

    await expect(rollbackMigration(config)).rejects.toThrow("Could not read");
  });

  test("applies multiple pending migrations in folder order", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const first = join(project.migrationsDir, "20240101000000000_first");
    const second = join(project.migrationsDir, "20240102000000000_second");
    const header = `-- semola-schema:${JSON.stringify({ tables: {} })}`;

    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, "up.sql"), `${header}\nSELECT 1;\n`);
    await writeFile(join(second, "up.sql"), `${header}\nSELECT 1;\n`);

    expect(await applyMigrations(config)).toEqual([
      "20240101000000000_first",
      "20240102000000000_second",
    ]);
  });

  test("apply fails sqlite foreign key checks before commit", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const posts = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id")
        .notNull()
        .references(() => authors.columns.id),
    });
    const schemaPath = join(project.root, "db.ts");

    await writeFile(
      schemaPath,
      `
import { createOrm, defineTable, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const authors = defineTable("authors", {
  id: uuid("id").primaryKey().notNull(),
});
const posts = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  authorId: uuid("author_id").notNull().references(() => authors.columns.id),
});

export const db = createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbFile)},
  tables: { authors, posts },
});
`,
    );

    const config = await loadConfig(project.root);

    await createMigration({ name: "init", config });
    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { authors, posts },
    });

    await db.authors.create({ data: { id: "a1" } });
    await db.posts.create({ data: { id: "p1", authorId: "a1" } });
    await db.$raw.close();

    const folder = join(project.migrationsDir, "99999999999999999_drop_parent");
    await mkdir(folder);
    await writeFile(
      join(folder, "up.sql"),
      `-- semola-schema:${JSON.stringify({ tables: {} })}\nDROP TABLE "authors";\n`,
    );

    await expect(applyMigrations(config)).rejects.toThrow(
      "Foreign key check failed",
    );

    const check = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { authors, posts },
    });
    const author = await check.authors.findFirst({ where: { id: "a1" } });

    expect(author?.id).toBe("a1");

    await check.$raw.close();
  });

  test("createMigration writes timestamped folder with up.sql and down.sql headers", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({
      name: "initialize_database",
      config,
    });

    expect(folder).toMatch(/^\d{17}_initialize_database$/);

    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();
    const down = await Bun.file(
      join(project.migrationsDir, folder, "down.sql"),
    ).text();

    expect(up.startsWith("-- semola-schema:")).toBe(true);
    expect(down).toContain('DROP TABLE "users"');
    expect(down).toContain("-- warning:");
  });

  test("lists pending migration names when create is blocked", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await expect(createMigration({ name: "second", config })).rejects.toThrow(
      folder,
    );
  });

  test("rejects empty and whitespace-only migration names", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await expect(createMigration({ name: "", config })).rejects.toThrow(
      "Invalid migration name",
    );
    await expect(createMigration({ name: "   ", config })).rejects.toThrow(
      "Invalid migration name",
    );
  });

  test("accepts snake_case migration names", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({
      name: "add_user_roles",
      config,
    });

    expect(folder).toContain("add_user_roles");
  });

  test("apply with an empty migrations directory is a no-op", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    expect(await applyMigrations(config)).toEqual([]);
  });

  test("creates the _semola_migrations history table on first apply", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const rows = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM _semola_migrations ORDER BY name`,
      )),
    ];

    expect(rows).toEqual([{ name: folder }]);

    await db.$raw.close();
  });

  test("rollback then re-apply restores the schema", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await applyMigrations(config);
    expect(await rollbackMigration(config)).toBe(folder);
    expect(await applyMigrations(config)).toEqual([folder]);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    await db.users.create({
      data: { id: "1", name: "Ada", email: "ada@example.com" },
    });

    expect(
      (
        await db.users.findFirst({
          where: { email: "ada@example.com" },
        })
      )?.name,
    ).toBe("Ada");

    await db.$raw.close();
  });

  test("after rollback the migration stays pending and blocks create", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await applyMigrations(config);
    await rollbackMigration(config);

    await expect(createMigration({ name: "again", config })).rejects.toThrow(
      folder,
    );
    expect(await applyMigrations(config)).toEqual([folder]);
  });

  test("stacked create/apply/rollback unwinds only the latest migration", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      bio: string("bio"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const second = await createMigration({
      name: "add_bio",
      config: nextConfig,
    });

    await applyMigrations(nextConfig);

    expect(await rollbackMigration(nextConfig)).toBe(second);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const cols = [...(await db.$raw.unsafe(`PRAGMA table_info("users")`))].map(
      (row) => row.name,
    );

    expect(cols).toContain("email");
    expect(cols).not.toContain("bio");

    await db.$raw.close();
  });

  test("adding a column end-to-end via create and apply", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      bio: string("bio"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };

    await createMigration({ name: "add_bio", config: nextConfig });
    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });

    await db.users.create({
      data: {
        id: "1",
        name: "Ada",
        email: "ada@example.com",
        bio: "hi",
      },
    });

    expect((await db.users.findFirst({ where: { id: "1" } }))?.bio).toBe("hi");

    await db.$raw.close();
  });

  test("failed apply SQL rolls back the transaction", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const folder = join(project.migrationsDir, "99999999999999999_bad_sql");
    await mkdir(folder);
    await writeFile(
      join(folder, "up.sql"),
      `-- semola-schema:${JSON.stringify({ tables: {} })}\nSELECT * FROM definitely_missing;\n`,
    );

    await expect(applyMigrations(config)).rejects.toThrow();

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const history = [
      ...(await db.$raw.unsafe(`SELECT name FROM _semola_migrations`)),
    ];
    const userTables = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
      )),
    ];

    expect(history).toHaveLength(1);
    expect(userTables).toHaveLength(1);

    await db.$raw.close();
  });

  test("rejects apply when the schema header JSON is invalid", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = join(project.migrationsDir, "20240101000000000_bad_header");

    await mkdir(folder);
    await writeFile(
      join(folder, "up.sql"),
      `-- semola-schema:{nope}\nSELECT 1;\n`,
    );

    await expect(applyMigrations(config)).rejects.toThrow(
      "Invalid schema header",
    );
  });

  test("rejects apply when the schema header is not a schema snapshot", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = join(project.migrationsDir, "20240101000000000_bad_shape");

    await mkdir(folder);
    await writeFile(join(folder, "up.sql"), `-- semola-schema:[]\nSELECT 1;\n`);

    await expect(applyMigrations(config)).rejects.toThrow(
      "Invalid schema header",
    );
  });

  test("rejects apply when history order does not match file order", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const first = join(project.migrationsDir, "20240101000000000_first");
    const second = join(project.migrationsDir, "20240102000000000_second");
    const inserted = join(project.migrationsDir, "20240101500000000_inserted");
    const header = `-- semola-schema:${JSON.stringify({ tables: {} })}`;

    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, "up.sql"), `${header}\nSELECT 1;\n`);
    await writeFile(join(second, "up.sql"), `${header}\nSELECT 1;\n`);
    await applyMigrations(config);

    await mkdir(inserted);
    await writeFile(join(inserted, "up.sql"), `${header}\nSELECT 1;\n`);

    await expect(applyMigrations(config)).rejects.toThrow(
      "does not match files",
    );
  });

  test("ignores non-directory entries in the migrations folder", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await writeFile(join(project.migrationsDir, "README.md"), "# migrations\n");
    await createMigration({ name: "first", config });

    expect(await applyMigrations(config)).toHaveLength(1);
  });

  test("loadConfig accepts a default-exported ORM client", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);
    dirs.push(dirname(dbFile));

    await writeFile(
      join(root, "db.ts"),
      `
import { createOrm, defineTable, string, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
});

export default createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbFile)},
  tables: { users },
});
`,
    );
    await writeFile(
      join(root, "semola.config.ts"),
      `
import { defineConfig } from ${JSON.stringify(join(import.meta.dir, "../../config.ts"))};

export default defineConfig({
  orm: { schema: "./db.ts" },
});
`,
    );
    await mkdir(join(root, "migrations"), { recursive: true });

    const config = await loadConfig(root);

    expect(config.orm.url).toBe(dbFile);
    expect(config.migrationsDir).toBe(join(root, "migrations"));
  });

  test("loadConfig respects a custom migrationsDir", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);
    dirs.push(dirname(dbFile));

    await writeFile(
      join(root, "db.ts"),
      `
import { createOrm, defineTable, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
});

export const db = createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbFile)},
  tables: { users },
});
`,
    );
    await writeFile(
      join(root, "semola.config.ts"),
      `
import { defineConfig } from ${JSON.stringify(join(import.meta.dir, "../../config.ts"))};

export default defineConfig({
  orm: {
    schema: "./db.ts",
    migrationsDir: "./db/migrations",
  },
});
`,
    );
    await mkdir(join(root, "db", "migrations"), { recursive: true });

    const config = await loadConfig(root);

    expect(config.migrationsDir).toBe(join(root, "db", "migrations"));

    const folder = await createMigration({ name: "init", config });

    expect(
      await Bun.file(join(root, "db", "migrations", folder, "up.sql")).exists(),
    ).toBe(true);
  });

  test("loadConfig fails when config has no orm.schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);

    await writeFile(
      join(root, "semola.config.ts"),
      `
import { defineConfig } from ${JSON.stringify(join(import.meta.dir, "../../config.ts"))};

export default defineConfig({});
`,
    );

    await expect(loadConfig(root)).rejects.toThrow();
  });

  test("unique constant default fails apply when the table already has multiple rows", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    await db.users.create({
      data: { id: "1", name: "Ada", email: "ada@example.com" },
    });
    await db.users.create({
      data: { id: "2", name: "Grace", email: "grace@example.com" },
    });
    await db.$raw.close();

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      role: string("role").notNull().unique().dbDefault("member"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };

    await createMigration({ name: "add_role", config: nextConfig });

    await expect(applyMigrations(nextConfig)).rejects.toThrow();

    const check = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const cols = [
      ...(await check.$raw.unsafe(`PRAGMA table_info("users")`)),
    ].map((row) => row.name);

    expect(cols).not.toContain("role");

    await check.$raw.close();
  });

  test("rollback fails when re-adding NOT NULL without default would break existing rows", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const withoutName = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: withoutName },
      },
    };

    await createMigration({ name: "drop_name", config: nextConfig });
    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: withoutName },
    });

    await db.users.create({
      data: { id: "1", email: "ada@example.com" },
    });
    await db.$raw.close();

    await expect(rollbackMigration(nextConfig)).rejects.toThrow();
  });

  test("rollback runs foreign key checks before commit", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const posts = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id")
        .notNull()
        .references(() => authors.columns.id),
    });

    await writeFile(
      join(project.root, "db.ts"),
      `
import { createOrm, defineTable, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const authors = defineTable("authors", {
  id: uuid("id").primaryKey().notNull(),
});
const posts = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  authorId: uuid("author_id").notNull().references(() => authors.columns.id),
});

export const db = createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbFile)},
  tables: { authors, posts },
});
`,
    );

    const config = await loadConfig(project.root);

    await createMigration({ name: "init", config });
    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { authors, posts },
    });

    await db.authors.create({ data: { id: "a1" } });
    await db.posts.create({ data: { id: "p1", authorId: "a1" } });
    await db.$raw.close();

    const folder = await createMigration({
      name: "noop_for_rollback_fk",
      config: {
        ...config,
        orm: {
          ...config.orm,
          tables: {
            authors,
            posts,
            tags: defineTable("tags", {
              id: uuid("id").primaryKey().notNull(),
            }),
          },
        },
      },
    });

    await applyMigrations({
      ...config,
      orm: {
        ...config.orm,
        tables: {
          authors,
          posts,
          tags: defineTable("tags", {
            id: uuid("id").primaryKey().notNull(),
          }),
        },
      },
    });

    // Break FK integrity, then craft a down that would commit orphan state
    // if foreign_key_check were skipped: replace down.sql with DROP authors.
    await writeFile(
      join(project.migrationsDir, folder, "down.sql"),
      `DROP TABLE "authors";\n`,
    );

    await expect(rollbackMigration(config)).rejects.toThrow(
      "Foreign key check failed",
    );
  });

  test("creates the _semola_migrations history table on first create", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const tables = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_semola_migrations'`,
      )),
    ];

    expect(tables).toHaveLength(1);

    await db.$raw.close();
  });

  test("history stores the applied schema snapshot from the up.sql header", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });
    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();
    const expected = decodeSchemaHeader(up);

    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const rows = [
      ...(await db.$raw.unsafe(`SELECT name, schema FROM _semola_migrations`)),
    ];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(folder);

    const stored =
      typeof rows[0]?.schema === "string"
        ? JSON.parse(rows[0].schema)
        : rows[0]?.schema;

    expect(stored).toEqual(expected);

    await db.$raw.close();
  });

  test("each pending migration commits in its own transaction", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const first = join(project.migrationsDir, "20240101000000000_first");
    const second = join(project.migrationsDir, "20240102000000000_second");
    const emptyHeader = `-- semola-schema:${JSON.stringify({ tables: {} })}`;

    await mkdir(first);
    await mkdir(second);
    await writeFile(
      join(first, "up.sql"),
      `${emptyHeader}\nCREATE TABLE "scratch" ("id" TEXT);\n`,
    );
    await writeFile(
      join(second, "up.sql"),
      `${emptyHeader}\nSELECT * FROM definitely_missing;\n`,
    );

    await expect(applyMigrations(config)).rejects.toThrow();

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const history = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM _semola_migrations ORDER BY name`,
      )),
    ];
    const scratch = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scratch'`,
      )),
    ];

    expect(history).toEqual([{ name: "20240101000000000_first" }]);
    expect(scratch).toHaveLength(1);

    await db.$raw.close();
  });

  test("concurrent apply does not double-apply the same migration", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "init", config });

    const results = await Promise.allSettled([
      applyMigrations(config),
      applyMigrations(config),
    ]);
    const appliedNames = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(new Set(appliedNames).size).toBe(appliedNames.length);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const history = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM _semola_migrations ORDER BY name`,
      )),
    ];

    expect(history).toHaveLength(1);

    await db.$raw.close();
  });

  test("unique constant default apply succeeds when the table has a single row", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    await db.users.create({
      data: { id: "1", name: "Ada", email: "ada@example.com" },
    });
    await db.$raw.close();

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      role: string("role").notNull().unique().dbDefault("member"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };

    await createMigration({ name: "add_role", config: nextConfig });
    await applyMigrations(nextConfig);

    const check = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });
    const user = await check.users.findFirst({ where: { id: "1" } });

    expect(user?.role).toBe("member");

    await check.$raw.close();
  });

  test("unique constant default apply succeeds when the table is empty", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      role: string("role").notNull().unique().dbDefault("member"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };

    await createMigration({ name: "add_role", config: nextConfig });
    expect(await applyMigrations(nextConfig)).toHaveLength(1);

    const check = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });
    const cols = [
      ...(await check.$raw.unsafe(`PRAGMA table_info("users")`)),
    ].map((row) => row.name);

    expect(cols).toContain("role");

    await check.$raw.close();
  });

  test("rollback removes the latest history entry", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });

    await applyMigrations(config);
    await rollbackMigration(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const history = [
      ...(await db.$raw.unsafe(`SELECT name FROM _semola_migrations`)),
    ];

    expect(history).toEqual([]);
    expect(folder).toContain("first");

    await db.$raw.close();
  });

  test("rejects apply when history has an extra applied entry", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    await db.$raw.unsafe(
      `INSERT INTO _semola_migrations (name, applied_at, schema) SELECT '99999999999999999_extra', applied_at, schema FROM _semola_migrations LIMIT 1`,
    );

    await db.$raw.close();

    await expect(applyMigrations(config)).rejects.toThrow(MigrationError);
  });

  test("failed rollback keeps the migration in history", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const withoutName = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: withoutName },
      },
    };
    const folder = await createMigration({
      name: "drop_name",
      config: nextConfig,
    });

    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: withoutName },
    });

    await db.users.create({
      data: { id: "1", email: "ada@example.com" },
    });
    await db.$raw.close();

    await expect(rollbackMigration(nextConfig)).rejects.toThrow();

    const check = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: withoutName },
    });
    const history = [
      ...(await check.$raw.unsafe(
        `SELECT name FROM _semola_migrations ORDER BY name`,
      )),
    ];

    expect(history.map((row) => row.name)).toContain(folder);

    await check.$raw.close();
  });

  test("create and apply throw MigrationError on documented failures", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });

    await expect(
      createMigration({ name: "second", config }),
    ).rejects.toBeInstanceOf(MigrationError);

    await applyMigrations(config);

    await expect(
      createMigration({ name: "noop", config }),
    ).rejects.toBeInstanceOf(MigrationError);
  });

  test("second create diffs against the last applied schema snapshot", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      bio: string("bio"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const folder = await createMigration({
      name: "add_bio",
      config: nextConfig,
    });
    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();

    expect(up).toContain('ADD COLUMN "bio"');
    expect(up).not.toContain('CREATE TABLE "users"');
  });

  test("primary key constant default fails apply when the table has multiple rows", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);
    dirs.push(dirname(dbFile));

    await writeFile(
      join(root, "db.ts"),
      `
import { createOrm, defineTable, string } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const users = defineTable("users", {
  email: string("email").notNull().unique(),
});

export const db = createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbFile)},
  tables: { users },
});
`,
    );
    await writeFile(
      join(root, "semola.config.ts"),
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
    await mkdir(join(root, "migrations"), { recursive: true });

    const config = await loadConfig(root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const before = defineTable("users", {
      email: string("email").notNull().unique(),
    });
    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: before },
    });

    await db.users.create({ data: { email: "ada@example.com" } });
    await db.users.create({ data: { email: "grace@example.com" } });
    await db.$raw.close();

    const after = defineTable("users", {
      id: string("id").primaryKey().notNull().dbDefault("fixed"),
      email: string("email").notNull().unique(),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: after },
      },
    };

    await createMigration({ name: "add_pk", config: nextConfig });

    await expect(applyMigrations(nextConfig)).rejects.toThrow();
  });

  test("dropping a table end-to-end via create, apply, and rollback", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const withAuthors = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: project.users, authors },
      },
    };
    const addFolder = await createMigration({
      name: "add_authors",
      config: withAuthors,
    });

    await applyMigrations(withAuthors);

    const withoutAuthors = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: project.users },
      },
    };
    const dropFolder = await createMigration({
      name: "drop_authors",
      config: withoutAuthors,
    });
    const up = await Bun.file(
      join(project.migrationsDir, dropFolder, "up.sql"),
    ).text();

    expect(up).toContain('DROP TABLE "authors"');
    expect(up).toContain("-- warning:");

    await applyMigrations(withoutAuthors);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const tables = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'authors'`,
      )),
    ];

    expect(tables).toHaveLength(0);

    expect(await rollbackMigration(withoutAuthors)).toBe(dropFolder);

    const restored = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'authors'`,
      )),
    ];

    expect(restored).toHaveLength(1);
    expect(addFolder).toContain("add_authors");

    await db.$raw.close();
  });

  test("stacked apply records every migration name in history order", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const first = await createMigration({ name: "first", config });

    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      bio: string("bio"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const second = await createMigration({
      name: "add_bio",
      config: nextConfig,
    });

    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });
    const history = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM _semola_migrations ORDER BY name`,
      )),
    ].map((row) => row.name);

    expect(history).toEqual([first, second]);

    await db.$raw.close();
  });

  test("latest history schema matches the latest up.sql header after stacked apply", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      bio: string("bio"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const second = await createMigration({
      name: "add_bio",
      config: nextConfig,
    });
    const up = await Bun.file(
      join(project.migrationsDir, second, "up.sql"),
    ).text();
    const expected = decodeSchemaHeader(up);

    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });
    const rows = [
      ...(await db.$raw.unsafe(
        `SELECT name, schema FROM _semola_migrations ORDER BY name DESC LIMIT 1`,
      )),
    ];

    expect(rows[0]?.name).toBe(second);

    const stored =
      typeof rows[0]?.schema === "string"
        ? JSON.parse(rows[0].schema)
        : rows[0]?.schema;

    expect(stored).toEqual(expected);
    expect(stored?.tables?.users?.columns?.bio).toBeDefined();

    await db.$raw.close();
  });

  test("createMigration fails with MigrationError when schema is unchanged", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    let error: unknown;

    try {
      await createMigration({ name: "noop", config });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MigrationError);
    expect((error as Error).message.toLowerCase()).toMatch(
      /no schema|unchanged|no change/,
    );
  });

  test("loadConfig defaults migrationsDir to migrations when omitted", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);
    dirs.push(dirname(dbFile));

    await writeFile(
      join(root, "db.ts"),
      `
import { createOrm, defineTable, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
});

export const db = createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbFile)},
  tables: { users },
});
`,
    );
    await writeFile(
      join(root, "semola.config.ts"),
      `
import { defineConfig } from ${JSON.stringify(join(import.meta.dir, "../../config.ts"))};

export default defineConfig({
  orm: { schema: "./db.ts" },
});
`,
    );

    const config = await loadConfig(root);

    expect(config.migrationsDir).toBe(join(root, "migrations"));
  });

  test("rollback restores the previous history schema snapshot", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const first = await createMigration({ name: "first", config });
    const firstUp = await Bun.file(
      join(project.migrationsDir, first, "up.sql"),
    ).text();
    const firstSchema = decodeSchemaHeader(firstUp);

    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      bio: string("bio"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };

    await createMigration({ name: "add_bio", config: nextConfig });
    await applyMigrations(nextConfig);
    await rollbackMigration(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const rows = [
      ...(await db.$raw.unsafe(`SELECT name, schema FROM _semola_migrations`)),
    ];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(first);

    const stored =
      typeof rows[0]?.schema === "string"
        ? JSON.parse(rows[0].schema)
        : rows[0]?.schema;

    expect(stored).toEqual(firstSchema);
    expect(stored?.tables?.users?.columns?.bio).toBeUndefined();

    await db.$raw.close();
  });

  test("createMigration creates the migrations directory when missing", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
    dirs.push(root);
    dirs.push(dirname(dbFile));

    await writeFile(
      join(root, "db.ts"),
      `
import { createOrm, defineTable, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
});

export const db = createOrm({
  adapter: "sqlite",
  url: ${JSON.stringify(dbFile)},
  tables: { users },
});
`,
    );
    await writeFile(
      join(root, "semola.config.ts"),
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

    const config = await loadConfig(root);
    const folder = await createMigration({ name: "init", config });

    expect(
      await Bun.file(join(root, "migrations", folder, "up.sql")).exists(),
    ).toBe(true);
  });

  test("dropping a nullable column end-to-end preserves existing rows", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const withBio = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      bio: string("bio"),
    });
    const withBioConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: withBio },
      },
    };

    await createMigration({ name: "add_bio", config: withBioConfig });
    await applyMigrations(withBioConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: withBio },
    });

    await db.users.create({
      data: {
        id: "1",
        name: "Ada",
        email: "ada@example.com",
        bio: "hi",
      },
    });
    await db.$raw.close();

    await createMigration({ name: "drop_bio", config });
    await applyMigrations(config);

    const check = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const user = await check.users.findFirst({ where: { id: "1" } });
    const cols = [
      ...(await check.$raw.unsafe(`PRAGMA table_info("users")`)),
    ].map((row) => row.name);

    expect(user?.name).toBe("Ada");
    expect(cols).not.toContain("bio");

    await check.$raw.close();
  });

  test("rollback of the only migration leaves an empty history table", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);
    await rollbackMigration(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const history = [
      ...(await db.$raw.unsafe(`SELECT name FROM _semola_migrations`)),
    ];
    const tables = [
      ...(await db.$raw.unsafe(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_semola_migrations'`,
      )),
    ];

    expect(history).toEqual([]);
    expect(tables).toHaveLength(1);

    await db.$raw.close();
  });

  test("normalizes hyphenated migration names to snake_case", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({
      name: "add-user-roles",
      config,
    });

    expect(folder).toMatch(/^\d{17}_add_user_roles$/);
  });

  test("generated down.sql does not include a schema header", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);
    const folder = await createMigration({ name: "first", config });
    const down = await Bun.file(
      join(project.migrationsDir, folder, "down.sql"),
    ).text();

    expect(down).not.toContain("-- semola-schema:");
  });

  test("history rows record an applied_at timestamp", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });
    const rows = [
      ...(await db.$raw.unsafe(`SELECT applied_at FROM _semola_migrations`)),
    ];

    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.applied_at).toBe("string");
    expect(Number.isNaN(Date.parse(String(rows[0]?.applied_at)))).toBe(false);

    await db.$raw.close();
  });

  test("failed pending migration can be fixed and re-applied", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const folder = join(project.migrationsDir, "99999999999999999_fixme");
    const header = `-- semola-schema:${JSON.stringify({ tables: {} })}`;

    await mkdir(folder);
    await writeFile(
      join(folder, "up.sql"),
      `${header}\nSELECT * FROM definitely_missing;\n`,
    );

    await expect(applyMigrations(config)).rejects.toThrow();

    await writeFile(join(folder, "up.sql"), `${header}\nSELECT 1;\n`);

    expect(await applyMigrations(config)).toEqual(["99999999999999999_fixme"]);
  });

  test("createMigration warns in up.sql for unique constant defaults", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      role: string("role").notNull().unique().dbDefault("member"),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const folder = await createMigration({
      name: "add_role",
      config: nextConfig,
    });
    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();

    expect(up).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("renames a table without dropping rows", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const seed = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    await seed.users.create({
      data: { id: "1", name: "Ada", email: "ada@example.com" },
    });
    await seed.$raw.close();

    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { people },
      },
    };
    const folder = await createMigration({
      name: "rename_users",
      config: nextConfig,
      onRename: () => "users",
    });
    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();
    const down = await Bun.file(
      join(project.migrationsDir, folder, "down.sql"),
    ).text();

    expect(up).toContain('ALTER TABLE "users" RENAME TO "people"');
    expect(up).not.toContain("DROP TABLE");
    expect(down).toContain('ALTER TABLE "people" RENAME TO "users"');

    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { people },
    });
    const row = await db.people.findFirst({ where: { id: "1" } });

    expect(row?.email).toBe("ada@example.com");

    await rollbackMigration(nextConfig);
    await db.$raw.close();

    const restored = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    expect((await restored.users.findFirst({ where: { id: "1" } }))?.name).toBe(
      "Ada",
    );

    await restored.$raw.close();
  });

  test("renames a column without dropping values", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const seed = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: project.users },
    });

    await seed.users.create({
      data: { id: "1", name: "Ada", email: "ada@example.com" },
    });
    await seed.$raw.close();

    const nextUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      fullName: string("fullName").notNull(),
      email: string("email").notNull().unique(),
    });
    const nextConfig = {
      ...config,
      orm: {
        ...config.orm,
        tables: { users: nextUsers },
      },
    };
    const folder = await createMigration({
      name: "rename_name",
      config: nextConfig,
      onRename: () => "name",
    });
    const up = await Bun.file(
      join(project.migrationsDir, folder, "up.sql"),
    ).text();

    expect(up).toContain(
      'ALTER TABLE "users" RENAME COLUMN "name" TO "fullName"',
    );

    await applyMigrations(nextConfig);

    const db = createOrm({
      adapter: "sqlite",
      url: dbFile,
      tables: { users: nextUsers },
    });

    expect((await db.users.findFirst({ where: { id: "1" } }))?.fullName).toBe(
      "Ada",
    );

    await db.$raw.close();
  });

  test("createMigration throws on possible table rename without onRename", async () => {
    const dbFile = join(await mkdtemp(join(tmpdir(), "semola-db-")), "test.db");
    const project = await setupProject(dbFile);
    const config = await loadConfig(project.root);

    await createMigration({ name: "first", config });
    await applyMigrations(config);

    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
    });

    await expect(
      createMigration({
        name: "people",
        config: {
          ...config,
          orm: { ...config.orm, tables: { people } },
        },
      }),
    ).rejects.toThrow("Possible table rename");
  });
});

if (SEMOLA_POSTGRES_URL) {
  const url = SEMOLA_POSTGRES_URL;

  describe("postgres migrations integration", () => {
    const dirs: string[] = [];
    const id = PG_ID;
    const id2 = PG_ID_2;

    afterEach(async () => {
      for (const dir of dirs.splice(0)) {
        await rm(dir, { recursive: true, force: true });
      }
    });

    const resetDb = () => resetPostgres(url);

    const setupProject = () => createMigrationProject(dirs, url, "postgres");

    const openDb = <T extends Record<string, ReturnType<typeof defineTable>>>(
      tables: T,
    ) =>
      createOrm({
        adapter: "postgres",
        url,
        tables,
      });

    test("create, apply, and rollback", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);
      const folder = await createMigration({
        name: "initialize_database",
        config,
      });
      const applied = await applyMigrations(config);

      expect(applied).toEqual([folder]);

      const db = openDb({ users: project.users });

      await db.users.create({
        data: { id, name: "Ada", email: "ada@example.com" },
      });

      expect(
        (await db.users.findFirst({ where: { email: "ada@example.com" } }))
          ?.name,
      ).toBe("Ada");

      const rolled = await rollbackMigration(config);

      expect(rolled).toBe(folder);

      await expect(
        db.users.findFirst({ where: { email: "ada@example.com" } }),
      ).rejects.toThrow();

      await db.$raw.close();
    });

    test("renames a table without dropping rows", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const seed = openDb({ users: project.users });

      await seed.users.create({
        data: { id, name: "Ada", email: "ada@example.com" },
      });
      await seed.$raw.close();

      const people = defineTable("people", {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull().unique(),
      });
      const nextConfig = {
        ...config,
        orm: {
          ...config.orm,
          tables: { people },
        },
      };

      await createMigration({
        name: "rename_users",
        config: nextConfig,
        onRename: () => "users",
      });
      await applyMigrations(nextConfig);

      const db = openDb({ people });

      expect((await db.people.findFirst({ where: { id } }))?.email).toBe(
        "ada@example.com",
      );

      await db.$raw.close();
    });

    test("renames constraints so later unique drops still apply", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const people = defineTable("people", {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull().unique(),
      });
      const renamed = {
        ...config,
        orm: { ...config.orm, tables: { people } },
      };

      await createMigration({
        name: "rename_users",
        config: renamed,
        onRename: () => "users",
      });
      await applyMigrations(renamed);

      const withoutUnique = defineTable("people", {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull(),
      });
      const next = {
        ...renamed,
        orm: { ...renamed.orm, tables: { people: withoutUnique } },
      };

      await createMigration({ name: "drop_email_unique", config: next });
      await applyMigrations(next);

      const db = openDb({ people: withoutUnique });

      await db.people.create({
        data: { id, name: "Ada", email: "same@example.com" },
      });
      await db.people.create({
        data: { id: id2, name: "Grace", email: "same@example.com" },
      });

      expect(
        (await db.people.findMany({ where: { email: "same@example.com" } }))
          .length,
      ).toBe(2);

      await db.$raw.close();
    });

    test("adding a column end-to-end via create and apply", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const nextUsers = defineTable("users", {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull().unique(),
        bio: string("bio"),
      });
      const nextConfig = {
        ...config,
        orm: {
          ...config.orm,
          tables: { users: nextUsers },
        },
      };

      await createMigration({ name: "add_bio", config: nextConfig });
      await applyMigrations(nextConfig);

      const db = openDb({ users: nextUsers });

      await db.users.create({
        data: {
          id,
          name: "Ada",
          email: "ada@example.com",
          bio: "hi",
        },
      });

      expect((await db.users.findFirst({ where: { id } }))?.bio).toBe("hi");

      await db.$raw.close();
    });

    test("renames a column without dropping values", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const seed = openDb({ users: project.users });

      await seed.users.create({
        data: { id, name: "Ada", email: "ada@example.com" },
      });
      await seed.$raw.close();

      const nextUsers = defineTable("users", {
        id: uuid("id").primaryKey().notNull(),
        fullName: string("fullName").notNull(),
        email: string("email").notNull().unique(),
      });
      const nextConfig = {
        ...config,
        orm: {
          ...config.orm,
          tables: { users: nextUsers },
        },
      };

      await createMigration({
        name: "rename_name",
        config: nextConfig,
        onRename: () => "name",
      });
      await applyMigrations(nextConfig);

      const db = openDb({ users: nextUsers });

      expect((await db.users.findFirst({ where: { id } }))?.fullName).toBe(
        "Ada",
      );

      await db.$raw.close();
    });

    test("dropping a nullable column end-to-end preserves existing rows", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const withBio = defineTable("users", {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull().unique(),
        bio: string("bio"),
      });
      const withBioConfig = {
        ...config,
        orm: {
          ...config.orm,
          tables: { users: withBio },
        },
      };

      await createMigration({ name: "add_bio", config: withBioConfig });
      await applyMigrations(withBioConfig);

      const db = openDb({ users: withBio });

      await db.users.create({
        data: {
          id,
          name: "Ada",
          email: "ada@example.com",
          bio: "hi",
        },
      });
      await db.$raw.close();

      await createMigration({ name: "drop_bio", config });
      await applyMigrations(config);

      const check = openDb({ users: project.users });
      const user = await check.users.findFirst({ where: { id } });
      const cols = [
        ...(await check.$raw.unsafe(`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
        `)),
      ].map((row) => row.name);

      expect(user?.name).toBe("Ada");
      expect(cols).not.toContain("bio");

      await check.$raw.close();
    });

    test("dropping a table end-to-end via create, apply, and rollback", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const authors = defineTable("authors", {
        id: uuid("id").primaryKey().notNull(),
      });
      const withAuthors = {
        ...config,
        orm: {
          ...config.orm,
          tables: { users: project.users, authors },
        },
      };
      const addFolder = await createMigration({
        name: "add_authors",
        config: withAuthors,
      });

      await applyMigrations(withAuthors);

      const withoutAuthors = {
        ...config,
        orm: {
          ...config.orm,
          tables: { users: project.users },
        },
      };
      const dropFolder = await createMigration({
        name: "drop_authors",
        config: withoutAuthors,
      });

      await applyMigrations(withoutAuthors);

      const db = openDb({ users: project.users });
      const tables = [
        ...(await db.$raw.unsafe(`
          SELECT table_name AS name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'authors'
        `)),
      ];

      expect(tables).toHaveLength(0);

      expect(await rollbackMigration(withoutAuthors)).toBe(dropFolder);

      const restored = [
        ...(await db.$raw.unsafe(`
          SELECT table_name AS name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'authors'
        `)),
      ];

      expect(restored).toHaveLength(1);
      expect(addFolder).toContain("add_authors");

      await db.$raw.close();
    });

    test("creates foreign keys between tables", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const posts = defineTable("posts", {
        id: uuid("id").primaryKey().notNull(),
        title: string("title").notNull(),
        authorId: uuid("author_id")
          .notNull()
          .references(() => project.users.columns.id),
      });
      const nextConfig = {
        ...config,
        orm: {
          ...config.orm,
          tables: { users: project.users, posts },
        },
      };

      await createMigration({ name: "add_posts", config: nextConfig });
      await applyMigrations(nextConfig);

      const db = openDb({ users: project.users, posts });

      await db.users.create({
        data: { id, name: "Ada", email: "ada@example.com" },
      });
      await db.posts.create({
        data: { id: id2, title: "Hello", authorId: id },
      });

      expect((await db.posts.findFirst({ where: { id: id2 } }))?.authorId).toBe(
        id,
      );

      await expect(
        db.posts.create({
          data: {
            id: "33333333-3333-3333-3333-333333333333",
            title: "Missing",
            authorId: "44444444-4444-4444-4444-444444444444",
          },
        }),
      ).rejects.toThrow();

      await db.$raw.close();
    });

    test("concurrent apply does not double-apply the same migration", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "init", config });

      const results = await Promise.allSettled([
        applyMigrations(config),
        applyMigrations(config),
      ]);
      const appliedNames = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );

      expect(results.some((result) => result.status === "fulfilled")).toBe(
        true,
      );
      expect(new Set(appliedNames).size).toBe(appliedNames.length);

      const db = openDb({ users: project.users });
      const history = [
        ...(await db.$raw.unsafe(
          `SELECT name FROM _semola_migrations ORDER BY name`,
        )),
      ];

      expect(history).toHaveLength(1);

      await db.$raw.close();
    });

    test("failed apply SQL rolls back the transaction", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const folder = join(project.migrationsDir, "99999999999999999_bad_sql");
      await mkdir(folder);
      await writeFile(
        join(folder, "up.sql"),
        `-- semola-schema:${JSON.stringify({ tables: {} })}\nSELECT * FROM definitely_missing;\n`,
      );

      await expect(applyMigrations(config)).rejects.toThrow();

      const db = openDb({ users: project.users });
      const history = [
        ...(await db.$raw.unsafe(`SELECT name FROM _semola_migrations`)),
      ];
      const userTables = [
        ...(await db.$raw.unsafe(`
          SELECT table_name AS name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'users'
        `)),
      ];

      expect(history).toHaveLength(1);
      expect(userTables).toHaveLength(1);

      await db.$raw.close();
    });

    test("stacked create/apply/rollback unwinds only the latest migration", async () => {
      await resetDb();

      const project = await setupProject();
      const config = await loadConfig(project.root);

      await createMigration({ name: "first", config });
      await applyMigrations(config);

      const nextUsers = defineTable("users", {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull().unique(),
        bio: string("bio"),
      });
      const nextConfig = {
        ...config,
        orm: {
          ...config.orm,
          tables: { users: nextUsers },
        },
      };
      const second = await createMigration({
        name: "add_bio",
        config: nextConfig,
      });

      await applyMigrations(nextConfig);

      expect(await rollbackMigration(nextConfig)).toBe(second);

      const db = openDb({ users: project.users });
      const cols = [
        ...(await db.$raw.unsafe(`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
        `)),
      ].map((row) => row.name);

      expect(cols).not.toContain("bio");
      expect(cols).toContain("email");

      await db.$raw.close();
    });
  });
}

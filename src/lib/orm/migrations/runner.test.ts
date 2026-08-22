import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { splitStatements } from "./sql.js";

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
    dirs.push(dirname(dbPath));

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

  test("splitStatements keeps semicolons inside dollar quotes and block comments", () => {
    expect(
      splitStatements(`
SELECT 1;
/* keep ; here */
SELECT $$a;b$$;
SELECT $tag$c;d$tag$;
`),
    ).toEqual([
      "SELECT 1",
      "/* keep ; here */\nSELECT $$a;b$$",
      "SELECT $tag$c;d$tag$",
    ]);
  });

  test("splitStatements keeps doubled quotes and strips the schema header", () => {
    expect(
      splitStatements(`-- semola-schema:{"tables":{}}
INSERT INTO t VALUES ('it''s');
SELECT "weird;name";
`),
    ).toEqual(["INSERT INTO t VALUES ('it''s')", `SELECT "weird;name"`]);
  });

  test("splitStatements ignores comment-only input", () => {
    expect(splitStatements("-- warning: hi\n-- still a comment\n")).toEqual([]);
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

  test.skipIf(!process.env.POSTGRES_URL)(
    "postgres apply and rollback survive an fk type change",
    async () => {
      const url = process.env.POSTGRES_URL;

      if (!url) return;

      const root = await mkdtemp(join(tmpdir(), "semola-pg-"));
      dirs.push(root);

      const schemaPath = join(root, "db.ts");
      const configPath = join(root, "semola.config.ts");
      const migrationsDir = join(root, "migrations");
      const ormIndex = JSON.stringify(join(import.meta.dir, "../index.ts"));
      const configIndex = JSON.stringify(
        join(import.meta.dir, "../../config.ts"),
      );
      const sql = new Bun.SQL(url, { adapter: "postgres" });

      try {
        await writeFile(
          schemaPath,
          `
import { createOrm, defineTable, string, uuid } from ${ormIndex};

const authors = defineTable("mig_authors", {
  id: uuid("id").primaryKey().notNull(),
});
const posts = defineTable("mig_posts", {
  id: uuid("id").primaryKey().notNull(),
  authorId: uuid("author_id").notNull().references(() => authors.columns.id),
});

export const db = createOrm({
  adapter: "postgres",
  url: ${JSON.stringify(url)},
  tables: { authors, posts },
});
`,
        );
        await writeFile(
          configPath,
          `
import { defineConfig } from ${configIndex};

export default defineConfig({
  orm: {
    schema: "./db.ts",
    migrationsDir: "./migrations",
  },
});
`,
        );
        await mkdir(migrationsDir, { recursive: true });

        const config = await loadConfig(root);

        await createMigration({ name: "init", config });
        await applyMigrations(config);

        await writeFile(
          schemaPath,
          `
import { createOrm, defineTable, string, uuid } from ${ormIndex};

const authors = defineTable("mig_authors", {
  id: string("id").primaryKey().notNull(),
});
const posts = defineTable("mig_posts", {
  id: uuid("id").primaryKey().notNull(),
  authorId: string("author_id").notNull().references(() => authors.columns.id),
});

export const db = createOrm({
  adapter: "postgres",
  url: ${JSON.stringify(url)},
  tables: { authors, posts },
});
`,
        );

        const next = await loadConfig(root);

        await createMigration({ name: "widen_ids", config: next });
        const applied = await applyMigrations(next);

        expect(applied).toHaveLength(1);

        await rollbackMigration(next);
        await rollbackMigration(config);
      } finally {
        await sql.unsafe("DROP TABLE IF EXISTS mig_posts");
        await sql.unsafe("DROP TABLE IF EXISTS mig_authors");
        await sql.unsafe("DROP TABLE IF EXISTS _semola_migrations");
        await sql.close();
      }
    },
  );

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

  test("splitStatements handles single-line comments with semicolons", () => {
    expect(
      splitStatements(`
SELECT 1; -- trailing ; here
SELECT 2;
`),
    ).toEqual(["SELECT 1", "SELECT 2"]);
  });

  test("splitStatements keeps empty statements out of the result", () => {
    expect(splitStatements("SELECT 1;;;\nSELECT 2;\n")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });
});

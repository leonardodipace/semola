import { describe, expect, test } from "bun:test";
import {
  boolean,
  date,
  enumType,
  json,
  jsonb,
  number,
  string,
  uuid,
} from "../column/index.js";
import { defineTable } from "../table/index.js";
import { diffSchemas } from "./diff.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import { decodeSchemaHeader, renderMigrationSql } from "./sql.js";

describe("orm migrations snapshot/diff/sql", () => {
  test("snapshots tables and columns", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique().dbDefault("x"),
    });

    const snapshot = snapshotSchema({ users });

    expect(snapshot.tables.users?.columns.id?.sqlType).toBe("uuid");
    expect(snapshot.tables.users?.columns.email?.isUnique).toBe(true);
    expect(snapshot.tables.users?.columns.email?.dbDefault).toBe("'x'");
  });

  test("diffs create table and renders sqlite sql", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
    });

    const to = snapshotSchema({ users });
    const ops = diffSchemas(emptySchema(), to, "sqlite");
    const sql = renderMigrationSql("sqlite", ops, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe("createTable");
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain(
      '"id" TEXT CONSTRAINT "users_pkey" PRIMARY KEY NOT NULL',
    );
    expect(sql).toContain(
      '"email" TEXT NOT NULL CONSTRAINT "users_email_key" UNIQUE',
    );
    expect(sql).toContain("-- semola-schema:");

    const down = renderMigrationSql(
      "sqlite",
      diffSchemas(to, emptySchema(), "sqlite", { strictAddColumn: false }),
    );

    expect(down).toContain('DROP TABLE "users"');
  });

  test("renders postgres uuid and types", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });

    const to = snapshotSchema({ users });
    const ops = diffSchemas(emptySchema(), to, "postgres");
    const sql = renderMigrationSql("postgres", ops);

    expect(sql).toContain(
      '"id" UUID CONSTRAINT "users_pkey" PRIMARY KEY NOT NULL',
    );
  });

  test("sqlite adds nullable columns in place", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
    });

    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops).toEqual([
      {
        kind: "addColumn",
        table: "users",
        column: expect.objectContaining({ name: "bio" }),
      },
    ]);
    expect(sql).toContain('ADD COLUMN "bio" TEXT');
  });

  test("refuses adding a not-null column without a default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "sqlite",
      ),
    ).toThrow("Cannot add NOT NULL column users.name without .dbDefault");
  });

  test("sqlite recreates table on column default change and copies rows", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: string("age").notNull(),
    });
    const afterUsers = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: string("age").notNull().dbDefault("0"),
    });

    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: afterUsers }),
      "sqlite",
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops[0]?.kind).toBe("recreateTable");
    expect(sql).toContain(
      'INSERT INTO "users__semola_tmp" ("id", "age") SELECT "id", "age" FROM "users"',
    );
    expect(sql).toContain('DROP TABLE "users"');
    expect(sql).toContain('RENAME TO "users"');
  });

  test("emits a table-level primary key for composite keys", () => {
    const members = defineTable("members", {
      orgId: uuid("org_id").primaryKey().notNull(),
      userId: uuid("user_id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ members }), "sqlite"),
    );

    expect(sql).toContain(
      'CONSTRAINT "members_pkey" PRIMARY KEY ("org_id", "user_id")',
    );
    expect(sql).not.toContain(
      '"org_id" TEXT CONSTRAINT "members_pkey" PRIMARY KEY',
    );
  });

  test("sqlite maps integer primary keys to INTEGER and other numbers to REAL", () => {
    const items = defineTable("items", {
      id: number("id").primaryKey().notNull(),
      price: number("price").notNull(),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ items }), "sqlite"),
    );

    expect(sql).toContain(
      '"id" INTEGER CONSTRAINT "items_pkey" PRIMARY KEY NOT NULL',
    );
    expect(sql).toContain('"price" REAL NOT NULL');
  });

  test("sqlite recreates the table when dropping a unique or primary key column", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("orders create table before add-column foreign keys", () => {
    const postsBefore = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
    });
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const postsAfter = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => authors.columns.id),
    });

    const ops = diffSchemas(
      snapshotSchema({ posts: postsBefore }),
      snapshotSchema({ authors, posts: postsAfter }),
      "postgres",
    );
    const sql = renderMigrationSql("postgres", ops);
    const createAt = sql.indexOf('CREATE TABLE "authors"');
    const addAt = sql.indexOf("ADD COLUMN");

    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(addAt).toBeGreaterThan(createAt);
    expect(sql).toContain(
      'CONSTRAINT "posts_author_id_fkey" REFERENCES "authors" ("id")',
    );
  });

  test("postgres drops foreign keys before dropping referenced tables", () => {
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const postsBefore = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => authors.columns.id),
    });
    const postsAfter = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id"),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ posts: postsAfter }),
        "postgres",
      ),
    );
    const dropFkAt = sql.indexOf("DROP CONSTRAINT");
    const dropAuthorsAt = sql.indexOf('DROP TABLE "authors"');

    expect(dropFkAt).toBeGreaterThanOrEqual(0);
    expect(dropAuthorsAt).toBeGreaterThan(dropFkAt);
  });

  test("postgres creates referenced table before adding a foreign key", () => {
    const postsBefore = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id"),
    });
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const postsAfter = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => authors.columns.id),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ posts: postsBefore }),
        snapshotSchema({ authors, posts: postsAfter }),
        "postgres",
      ),
    );

    expect(sql.indexOf('CREATE TABLE "authors"')).toBeLessThan(
      sql.indexOf('ADD CONSTRAINT "posts_author_id_fkey"'),
    );
  });

  test("sqlite recreates a child table before dropping its parent", () => {
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const postsBefore = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => authors.columns.id),
      title: string("title"),
    });
    const postsAfter = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      title: string("title").notNull().dbDefault(""),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ posts: postsAfter }),
        "sqlite",
      ),
    );
    const recreateAt = sql.indexOf("posts__semola_tmp");
    const dropAuthorsAt = sql.indexOf('DROP TABLE "authors"');

    expect(recreateAt).toBeGreaterThanOrEqual(0);
    expect(dropAuthorsAt).toBeGreaterThan(recreateAt);
  });

  test("postgres add-column primary key adds the constraint after the column", () => {
    const before = defineTable("users", {
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      id: uuid("id")
        .primaryKey()
        .notNull()
        .dbDefault("gen_random_uuid()", { as: "sql" }),
      email: string("email").notNull().unique(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );
    const addColumnAt = sql.indexOf("ADD COLUMN");
    const addPkAt = sql.indexOf('ADD CONSTRAINT "users_pkey" PRIMARY KEY');

    expect(sql).toContain("ADD COLUMN");
    expect(sql).not.toContain(
      'ADD COLUMN "id" UUID CONSTRAINT "users_pkey" PRIMARY KEY',
    );
    expect(addPkAt).toBeGreaterThan(addColumnAt);
  });

  test("postgres drops primary key before dropping NOT NULL", () => {
    const before = defineTable("users", {
      id: string("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: string("id"),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql.indexOf("DROP CONSTRAINT")).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf("DROP CONSTRAINT")).toBeLessThan(
      sql.indexOf("DROP NOT NULL"),
    );
  });

  test("postgres drops the old primary key before adding a new one", () => {
    const before = defineTable("users", {
      email: string("email").notNull().unique(),
      id: string("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      email: string("email").primaryKey().notNull(),
      id: string("id").notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql.indexOf('DROP CONSTRAINT "users_pkey"')).toBeLessThan(
      sql.indexOf('ADD CONSTRAINT "users_pkey" PRIMARY KEY'),
    );
  });

  test("postgres unique to primary key drops the unique constraint", () => {
    const before = defineTable("users", {
      id: string("id").notNull().unique(),
    });
    const after = defineTable("users", {
      id: string("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "users_id_key"');
    expect(sql).toContain('ADD CONSTRAINT "users_pkey" PRIMARY KEY');
    expect(sql.indexOf("DROP CONSTRAINT")).toBeLessThan(
      sql.indexOf('ADD CONSTRAINT "users_pkey" PRIMARY KEY'),
    );
  });

  test("postgres primary key to unique adds a unique constraint", () => {
    const before = defineTable("users", {
      id: string("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: string("id").notNull().unique(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('ADD CONSTRAINT "users_id_key" UNIQUE');
    expect(sql).toContain('DROP CONSTRAINT "users_pkey"');
  });

  test("allows self-referential foreign keys", () => {
    let nodes = defineTable("nodes", {
      id: uuid("id").primaryKey().notNull(),
    });
    nodes = defineTable("nodes", {
      id: uuid("id").primaryKey().notNull(),
      parentId: uuid("parent_id").references(() => nodes.columns.id),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ nodes }), "sqlite"),
    );

    expect(sql).toContain('REFERENCES "nodes" ("id")');
  });

  test("postgres creates circular foreign keys after both tables exist", () => {
    let b = defineTable("b", {
      id: uuid("id").primaryKey().notNull(),
    });
    const a = defineTable("a", {
      id: uuid("id").primaryKey().notNull(),
      bId: uuid("b_id").references(() => b.columns.id),
    });
    b = defineTable("b", {
      id: uuid("id").primaryKey().notNull(),
      aId: uuid("a_id").references(() => a.columns.id),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ a, b }), "postgres"),
    );
    const createAAt = sql.indexOf('CREATE TABLE "a"');
    const createBAt = sql.indexOf('CREATE TABLE "b"');
    const addAFkAt = sql.indexOf('ADD CONSTRAINT "a_b_id_fkey"');
    const addBFkAt = sql.indexOf('ADD CONSTRAINT "b_a_id_fkey"');

    expect(sql).not.toContain("Circular foreign key");
    expect(createAAt).toBeGreaterThanOrEqual(0);
    expect(createBAt).toBeGreaterThanOrEqual(0);
    expect(addAFkAt).toBeGreaterThan(createAAt);
    expect(addAFkAt).toBeGreaterThan(createBAt);
    expect(addBFkAt).toBeGreaterThan(createAAt);
    expect(addBFkAt).toBeGreaterThan(createBAt);
    expect(sql.slice(0, Math.min(addAFkAt, addBFkAt))).not.toContain(
      "REFERENCES",
    );
  });

  test("postgres drops inbound foreign keys before altering a referenced column type", () => {
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const posts = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => authors.columns.id),
    });
    const authorsAfter = defineTable("authors", {
      id: string("id").primaryKey().notNull(),
    });
    const postsAfter = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: string("author_id").references(() => authorsAfter.columns.id),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ authors, posts }),
        snapshotSchema({ authors: authorsAfter, posts: postsAfter }),
        "postgres",
      ),
    );
    const dropFkAt = sql.indexOf('DROP CONSTRAINT "posts_author_id_fkey"');
    const alterTypeAt = sql.indexOf("TYPE TEXT");
    const addFkAt = sql.indexOf('ADD CONSTRAINT "posts_author_id_fkey"');

    expect(dropFkAt).toBeGreaterThanOrEqual(0);
    expect(alterTypeAt).toBeGreaterThan(dropFkAt);
    expect(addFkAt).toBeGreaterThan(alterTypeAt);
  });

  test("postgres rebuilds a composite primary key as a table constraint", () => {
    const before = defineTable("members", {
      orgId: uuid("org_id").primaryKey().notNull(),
      userId: uuid("user_id").notNull(),
    });
    const after = defineTable("members", {
      orgId: uuid("org_id").primaryKey().notNull(),
      userId: uuid("user_id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ members: before }),
        snapshotSchema({ members: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "members_pkey"');
    expect(sql).toContain(
      'ADD CONSTRAINT "members_pkey" PRIMARY KEY ("org_id", "user_id")',
    );
    expect(sql).not.toContain('PRIMARY KEY ("user_id")');
    expect(sql.indexOf("DROP CONSTRAINT")).toBeLessThan(
      sql.indexOf("ADD CONSTRAINT"),
    );
  });

  test("warns when a table is dropped and another is created", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ users }),
        snapshotSchema({ people }),
        "sqlite",
      ),
    );

    expect(sql).toContain(
      "-- warning: drops table(s) users and creates people; table renames are drop+create and do not copy data",
    );
  });

  test("warns when adding a unique column with a constant default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique().dbDefault("x"),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("warns when down SQL re-adds a NOT NULL column without a default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const down = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ users: after }),
        snapshotSchema({ users: before }),
        "sqlite",
        { strictAddColumn: false },
      ),
    );

    expect(down).toContain(
      'ADD COLUMN "users"."name" NOT NULL without default fails if the table has rows',
    );
  });

  test("updates postgres enum check constraints", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live"]).notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live", "archived"]).notNull(),
    });

    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "users_status_check"');
    expect(sql).toContain('ADD CONSTRAINT "users_status_check"');
    expect(sql).toContain("'archived'");
    expect(sql).not.toContain("ALTER COLUMN");
  });

  test("postgres type changes use USING CAST", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: string("age").notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: number("age").notNull(),
    });

    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain(
      'ALTER COLUMN "age" TYPE DOUBLE PRECISION USING CAST("age" AS DOUBLE PRECISION)',
    );
  });

  test("postgres drops defaults before TYPE then sets the new default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: string("age").notNull().dbDefault("0"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: number("age").notNull().dbDefault(1),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql.indexOf("DROP DEFAULT")).toBeLessThan(sql.indexOf("TYPE "));
    expect(sql.indexOf("TYPE ")).toBeLessThan(sql.indexOf("SET DEFAULT"));
  });

  test("postgres drops enum checks before TYPE", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live"]).notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: number("status").notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql.indexOf('DROP CONSTRAINT "users_status_check"')).toBeLessThan(
      sql.indexOf("TYPE "),
    );
  });

  test("decodeSchemaHeader rejects invalid json", () => {
    expect(() => decodeSchemaHeader("-- semola-schema:{nope")).toThrow(
      "Invalid schema header",
    );
  });

  test("decodeSchemaHeader accepts CRLF line endings", () => {
    const schema = { tables: {} };
    const header = `-- semola-schema:${JSON.stringify(schema)}\r\n`;

    expect(decodeSchemaHeader(header)).toEqual(schema);
  });

  test("snapshots foreign keys", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const posts = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id")
        .notNull()
        .references(() => users.columns.id),
    });

    const snapshot = snapshotSchema({ users, posts });

    expect(snapshot.tables.posts?.columns.author_id?.references).toEqual({
      table: "users",
      column: "id",
    });
  });

  test("throws when a foreign key target is not in the schema", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const posts = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id")
        .notNull()
        .references(() => users.columns.id),
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "not in createOrm({ tables })",
    );
  });

  test("quotes JS dbDefault values and passes as: sql through", () => {
    const quoted = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull().dbDefault("'anon'", { as: "sql" }),
    });
    const bare = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull().dbDefault("anon"),
    });
    const apostrophe = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull().dbDefault("it's"),
    });
    const generated = defineTable("users", {
      id: uuid("id").primaryKey().notNull().dbDefault("gen_random_uuid()", {
        as: "sql",
      }),
    });

    expect(
      snapshotSchema({ users: quoted }).tables.users?.columns.role?.dbDefault,
    ).toBe("'anon'");
    expect(
      snapshotSchema({ users: bare }).tables.users?.columns.role?.dbDefault,
    ).toBe("'anon'");
    expect(
      snapshotSchema({ users: apostrophe }).tables.users?.columns.role
        ?.dbDefault,
    ).toBe("'it''s'");
    expect(
      snapshotSchema({ users: generated }).tables.users?.columns.id?.dbDefault,
    ).toBe("gen_random_uuid()");

    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users: generated }),
        "postgres",
      ),
    );

    expect(sql).toContain("DEFAULT gen_random_uuid()");
  });

  test("throws for an empty SQL dbDefault", () => {
    expect(() => string("role").dbDefault("  ", { as: "sql" })).toThrow(
      "empty dbDefault",
    );
  });

  test("warns when a table drops and adds columns", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      about: string("about"),
    });

    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "sqlite",
      ),
    );

    expect(sql).toContain(
      '-- warning: "users" drops bio and adds about; renames are drop+add and do not copy data',
    );
  });

  test("renders json, jsonb, boolean, and date types", () => {
    const events = defineTable("events", {
      id: uuid("id").primaryKey().notNull(),
      ok: boolean("ok").notNull(),
      at: date("at").notNull(),
      meta: json("meta"),
      extra: jsonb("extra"),
    });
    const sqlite = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ events }), "sqlite"),
    );
    const postgres = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ events }), "postgres"),
    );

    expect(sqlite).toContain('"ok" INTEGER NOT NULL');
    expect(sqlite).toContain('"at" TEXT NOT NULL');
    expect(sqlite).toContain('"meta" TEXT');
    expect(sqlite).toContain('"extra" TEXT');
    expect(postgres).toContain('"ok" BOOLEAN NOT NULL');
    expect(postgres).toContain('"at" TIMESTAMP NOT NULL');
    expect(postgres).toContain('"meta" JSON');
    expect(postgres).toContain('"extra" JSONB');
  });

  test("sqlite adds a column with a default in place", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull().dbDefault("member"),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops[0]?.kind).toBe("addColumn");
    expect(sql).toContain("ADD COLUMN \"role\" TEXT NOT NULL DEFAULT 'member'");
    expect(sql).not.toContain("users__semola_tmp");
  });

  test("postgres reference-only changes emit foreign key ops, not ALTER COLUMN", () => {
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const postsBefore = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id"),
    });
    const postsAfter = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => authors.columns.id),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ authors, posts: postsAfter }),
        "postgres",
      ),
    );

    expect(sql).toContain('ADD CONSTRAINT "posts_author_id_fkey"');
    expect(sql).not.toContain("ALTER COLUMN");
    expect(sql).not.toContain("no-op alter");
  });

  test("postgres drops and sets defaults without a type change", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull().dbDefault("a"),
    });
    const dropped = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull(),
    });
    const replaced = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull().dbDefault("b"),
    });

    expect(
      renderMigrationSql(
        "postgres",
        diffSchemas(
          snapshotSchema({ users: before }),
          snapshotSchema({ users: dropped }),
          "postgres",
        ),
      ),
    ).toContain('ALTER COLUMN "role" DROP DEFAULT');
    expect(
      renderMigrationSql(
        "postgres",
        diffSchemas(
          snapshotSchema({ users: dropped }),
          snapshotSchema({ users: replaced }),
          "postgres",
        ),
      ),
    ).toContain("SET DEFAULT 'b'");
  });

  test("postgres toggles nullability and unique constraints", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('ALTER COLUMN "email" SET NOT NULL');
    expect(sql).toContain('ADD CONSTRAINT "users_email_key" UNIQUE');
  });

  test("throws when adding a foreign key without a target", () => {
    expect(() =>
      renderMigrationSql("postgres", [
        {
          kind: "addForeignKey",
          table: "posts",
          column: {
            name: "author_id",
            type: "string",
            isNullable: true,
            isPrimaryKey: false,
            isUnique: false,
          },
        },
      ]),
    ).toThrow("without a target");
  });

  test("sqlite recreates when dropping the last shared column set still copies remaining columns", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "sqlite",
      ),
    );

    expect(sql).toContain(
      'INSERT INTO "users__semola_tmp" ("id", "bio") SELECT "id", "bio" FROM "users"',
    );
  });
});

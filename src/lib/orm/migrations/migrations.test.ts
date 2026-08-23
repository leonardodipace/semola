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
import { assertSchemaSnapshot, renderMigrationSql } from "./sql.js";
import type { SchemaSnapshot } from "./types.js";

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
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe("createTable");
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain(
      '"id" TEXT CONSTRAINT "users_pkey" PRIMARY KEY NOT NULL',
    );
    expect(sql).toContain(
      '"email" TEXT NOT NULL CONSTRAINT "users_email_key" UNIQUE',
    );

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

    const createAuthorsAt = sql.indexOf('CREATE TABLE "authors"');
    const addFkAt = sql.indexOf('ADD CONSTRAINT "posts_author_id_fkey"');

    expect(createAuthorsAt).toBeGreaterThanOrEqual(0);
    expect(addFkAt).toBeGreaterThan(createAuthorsAt);
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
    expect(addColumnAt).toBeGreaterThanOrEqual(0);
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
    const dropConstraintAt = sql.indexOf("DROP CONSTRAINT");
    const dropNotNullAt = sql.indexOf("DROP NOT NULL");

    expect(dropConstraintAt).toBeGreaterThanOrEqual(0);
    expect(dropNotNullAt).toBeGreaterThan(dropConstraintAt);
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
    const dropPkAt = sql.indexOf('DROP CONSTRAINT "users_pkey"');
    const addPkAt = sql.indexOf('ADD CONSTRAINT "users_pkey" PRIMARY KEY');

    expect(dropPkAt).toBeGreaterThanOrEqual(0);
    expect(addPkAt).toBeGreaterThan(dropPkAt);
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
    const dropUniqueAt = sql.indexOf("DROP CONSTRAINT");
    const addPkAt = sql.indexOf('ADD CONSTRAINT "users_pkey" PRIMARY KEY');

    expect(sql).toContain('DROP CONSTRAINT "users_id_key"');
    expect(sql).toContain('ADD CONSTRAINT "users_pkey" PRIMARY KEY');
    expect(dropUniqueAt).toBeGreaterThanOrEqual(0);
    expect(addPkAt).toBeGreaterThan(dropUniqueAt);
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

  test("sqlite rejects circular foreign keys between new tables", () => {
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

    expect(() =>
      renderMigrationSql(
        "sqlite",
        diffSchemas(emptySchema(), snapshotSchema({ a, b }), "sqlite"),
      ),
    ).toThrow("Circular foreign keys between new tables are not supported");
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

    const dropConstraintAt = sql.indexOf("DROP CONSTRAINT");
    const addConstraintAt = sql.indexOf("ADD CONSTRAINT");

    expect(dropConstraintAt).toBeGreaterThanOrEqual(0);
    expect(addConstraintAt).toBeGreaterThan(dropConstraintAt);
  });

  test("postgres drops primary key before dropping a composite key column", () => {
    const before = defineTable("members", {
      orgId: uuid("org_id").primaryKey().notNull(),
      userId: uuid("user_id").primaryKey().notNull(),
    });
    const after = defineTable("members", {
      orgId: uuid("org_id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ members: before }),
        snapshotSchema({ members: after }),
        "postgres",
      ),
    );
    const dropPkAt = sql.indexOf('DROP CONSTRAINT "members_pkey"');
    const dropColumnAt = sql.indexOf('DROP COLUMN "user_id"');
    const addPkAt = sql.indexOf(
      'ADD CONSTRAINT "members_pkey" PRIMARY KEY ("org_id")',
    );

    expect(dropPkAt).toBeGreaterThanOrEqual(0);
    expect(dropColumnAt).toBeGreaterThan(dropPkAt);
    expect(addPkAt).toBeGreaterThan(dropColumnAt);
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
      "-- warning: drops table(s) users and creates people; data in dropped tables will be lost",
    );
  });

  test("warns when a table is dropped without a matching create", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(snapshotSchema({ users }), emptySchema(), "sqlite", {
        strictAddColumn: false,
      }),
    );

    expect(sql).toContain(
      "-- warning: drops table(s) users; data in those tables will be lost",
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

  test("warns when adding a unique column with a scientific-notation default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      score: number("score").notNull().unique().dbDefault("1e3", { as: "sql" }),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "sqlite",
      ),
    );

    expect(sql).toContain("ADD COLUMN");
    expect(sql).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("warns when postgres sets NOT NULL on an existing column", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull(),
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
    expect(sql).toContain(
      'ALTER COLUMN "users"."email" SET NOT NULL fails if existing rows contain NULL',
    );
  });

  test("warns when sqlite recreates a table to tighten nullability", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().dbDefault(""),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "sqlite",
      ),
    );

    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain(
      'recreate "users"."email" as NOT NULL fails if existing rows contain NULL',
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

  test("sqlite recreate casts columns when types change", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: string("age").notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: number("age").notNull(),
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
      'INSERT INTO "users__semola_tmp" ("id", "age") SELECT "id", CAST("age" AS REAL) FROM "users"',
    );
    expect(sql).toContain('CONSTRAINT "users_pkey"');
    expect(sql).not.toContain("users__semola_tmp_pkey");
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

    const dropDefaultAt = sql.indexOf("DROP DEFAULT");
    const typeAt = sql.indexOf("TYPE ");
    const setDefaultAt = sql.indexOf("SET DEFAULT");

    expect(dropDefaultAt).toBeGreaterThanOrEqual(0);
    expect(typeAt).toBeGreaterThan(dropDefaultAt);
    expect(setDefaultAt).toBeGreaterThan(typeAt);
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
    const dropCheckAt = sql.indexOf('DROP CONSTRAINT "users_status_check"');
    const typeAt = sql.indexOf("TYPE ");

    expect(dropCheckAt).toBeGreaterThanOrEqual(0);
    expect(typeAt).toBeGreaterThan(dropCheckAt);
  });

  test("assertSchemaSnapshot rejects non-object payloads", () => {
    expect(() => assertSchemaSnapshot([], "schema.json")).toThrow(
      "Invalid schema.json",
    );
    expect(() => assertSchemaSnapshot(null, "schema.json")).toThrow(
      "Invalid schema.json",
    );
    expect(() => assertSchemaSnapshot(1, "schema.json")).toThrow(
      "Invalid schema.json",
    );
    expect(() => assertSchemaSnapshot({}, "schema.json")).toThrow(
      "Invalid schema.json",
    );
    expect(() => assertSchemaSnapshot({ tables: null }, "schema.json")).toThrow(
      "Invalid schema.json",
    );
    expect(() =>
      assertSchemaSnapshot({ tables: { users: 1 } }, "schema.json"),
    ).toThrow("Invalid schema.json");
    expect(() =>
      assertSchemaSnapshot(
        { tables: { users: { name: "users", columns: { id: 1 } } } },
        "schema.json",
      ),
    ).toThrow("Invalid schema.json");
    expect(() =>
      assertSchemaSnapshot(
        {
          tables: {
            users: {
              name: "people",
              columns: {},
            },
          },
        },
        "schema.json",
      ),
    ).toThrow("does not match name");
  });

  test("assertSchemaSnapshot accepts a schema object", () => {
    const schema = {
      tables: {
        users: {
          name: "users",
          columns: {
            id: {
              name: "id",
              type: "string",
              isNullable: false,
              isPrimaryKey: true,
              isUnique: false,
              sqlType: "uuid",
            },
          },
        },
      },
    } satisfies SchemaSnapshot;

    expect(assertSchemaSnapshot({ tables: {} }, "schema.json")).toEqual({
      tables: {},
    });
    expect(assertSchemaSnapshot(schema, "schema.json")).toEqual(schema);
  });

  test("assertSchemaSnapshot rejects dangling foreign-key targets", () => {
    expect(() =>
      assertSchemaSnapshot(
        {
          tables: {
            posts: {
              name: "posts",
              columns: {
                authorId: {
                  name: "authorId",
                  type: "string",
                  isNullable: true,
                  isPrimaryKey: false,
                  isUnique: false,
                  references: { table: "users", column: "id" },
                },
              },
            },
          },
        },
        "schema.json",
      ),
    ).toThrow("references missing table users");
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

  test("rejects multi-statement SQL dbDefault before render", () => {
    expect(() =>
      string("role").dbDefault("1; SELECT 1", { as: "sql" }),
    ).toThrow('single expression (no ";")');
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

    expect(sql).toContain('-- warning: "users" drops bio and adds about');
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

  test("sqlite recreates the table when adding a column with a non-constant default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      createdAt: string("created_at")
        .notNull()
        .dbDefault("CURRENT_TIMESTAMP", { as: "sql" }),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops[0]?.kind).toBe("recreateTable");
    expect(sql).toContain("CURRENT_TIMESTAMP");
    expect(sql).toContain("users__semola_tmp");
    expect(sql).not.toContain("ADD COLUMN");
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
  });

  test("sqlite recreates table for reference-only foreign key changes", () => {
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
    const ops = diffSchemas(
      snapshotSchema({ authors, posts: postsBefore }),
      snapshotSchema({ authors, posts: postsAfter }),
      "sqlite",
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops.some((op) => op.kind === "recreateTable")).toBe(true);
    expect(sql).toContain("posts__semola_tmp");
    expect(sql).toContain('REFERENCES "authors" ("id")');
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

  test("sqlite copies the remaining columns when it recreates a table to drop a unique column", () => {
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

  test("emptySchema has no tables", () => {
    expect(emptySchema()).toEqual({ tables: {} });
  });

  test("identical schemas produce no ops", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const snapshot = snapshotSchema({ users });

    expect(diffSchemas(snapshot, snapshot, "sqlite")).toEqual([]);
    expect(diffSchemas(snapshot, snapshot, "postgres")).toEqual([]);
  });

  test("snapshots enum values and nullability", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live"]),
      bio: string("bio"),
    });
    const snapshot = snapshotSchema({ users });

    expect(snapshot.tables.users?.columns.status?.type).toBe("enum");
    expect(snapshot.tables.users?.columns.status?.enumValues).toEqual([
      "draft",
      "live",
    ]);
    expect(snapshot.tables.users?.columns.status?.isNullable).toBe(true);
    expect(snapshot.tables.users?.columns.bio?.isNullable).toBe(true);
    expect(snapshot.tables.users?.columns.id?.isNullable).toBe(false);
  });

  test("snapshots boolean, date, json, jsonb, and number column types", () => {
    const events = defineTable("events", {
      id: uuid("id").primaryKey().notNull(),
      ok: boolean("ok").notNull(),
      at: date("at").notNull(),
      meta: json("meta"),
      extra: jsonb("extra"),
      score: number("score").notNull(),
    });
    const columns = snapshotSchema({ events }).tables.events?.columns;

    expect(columns?.ok?.type).toBe("boolean");
    expect(columns?.at?.type).toBe("date");
    expect(columns?.meta?.type).toBe("json");
    expect(columns?.extra?.type).toBe("jsonb");
    expect(columns?.score?.type).toBe("number");
  });

  test("renders enum check constraints on create table", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live"]).notNull(),
    });
    const sqlite = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ users }), "sqlite"),
    );
    const postgres = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ users }), "postgres"),
    );

    expect(sqlite).toContain('CONSTRAINT "users_status_check"');
    expect(sqlite).toContain("'draft'");
    expect(sqlite).toContain("'live'");
    expect(postgres).toContain('CONSTRAINT "users_status_check"');
    expect(postgres).toContain("'draft'");
    expect(postgres).toContain("'live'");
  });

  test("narrowing an enum updates the check constraint", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live", "archived"]).notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live"]).notNull(),
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
    expect(sql).toContain("'draft'");
    expect(sql).toContain("'live'");
    expect(sql).not.toContain("'archived'");
  });

  test("allows adding a NOT NULL column when a default is present", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull().dbDefault("anon"),
    });

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "sqlite",
      ),
    ).not.toThrow();
    expect(() =>
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    ).not.toThrow();
  });

  test("sqlite drops a nullable column in place", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops).toEqual([
      {
        kind: "dropColumn",
        table: "users",
        column: expect.objectContaining({ name: "bio" }),
      },
    ]);
    expect(sql).toContain('DROP COLUMN "bio"');
    expect(sql).not.toContain("users__semola_tmp");
  });

  test("postgres drops a column in place", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('DROP COLUMN "bio"');
  });

  test("sqlite recreates the table on type changes", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: string("age").notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      age: number("age").notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("sqlite recreates the table when toggling nullability", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().dbDefault(""),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("sqlite recreates the table when adding a unique constraint", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("postgres drops a unique constraint without altering the column type", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "users_email_key"');
    expect(sql).not.toContain("ALTER COLUMN");
  });

  test("creates multiple tables without foreign keys in any stable order", () => {
    const a = defineTable("a", {
      id: uuid("id").primaryKey().notNull(),
    });
    const b = defineTable("b", {
      id: uuid("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ a, b }), "sqlite"),
    );

    expect(sql).toContain('CREATE TABLE "a"');
    expect(sql).toContain('CREATE TABLE "b"');
  });

  test("inline foreign keys appear on create table for both adapters", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const posts = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id")
        .notNull()
        .references(() => users.columns.id),
    });
    const sqlite = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ users, posts }), "sqlite"),
    );
    const postgres = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ users, posts }), "postgres"),
    );

    expect(sqlite).toContain('REFERENCES "users" ("id")');
    expect(postgres).toContain('REFERENCES "users" ("id")');
  });

  test("postgres SET NOT NULL comes before adding a unique constraint", () => {
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
    const notNullAt = sql.indexOf("SET NOT NULL");
    const uniqueAt = sql.indexOf('ADD CONSTRAINT "users_email_key" UNIQUE');

    expect(notNullAt).toBeGreaterThanOrEqual(0);
    expect(uniqueAt).toBeGreaterThan(notNullAt);
  });

  test("postgres DROP NOT NULL follows dropping a unique constraint", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email"),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );
    const dropUniqueAt = sql.indexOf('DROP CONSTRAINT "users_email_key"');
    const dropNotNullAt = sql.indexOf("DROP NOT NULL");

    expect(dropUniqueAt).toBeGreaterThanOrEqual(0);
    expect(dropNotNullAt).toBeGreaterThan(dropUniqueAt);
  });

  test("boolean and number dbDefaults render correctly", () => {
    const flags = defineTable("flags", {
      id: uuid("id").primaryKey().notNull(),
      on: boolean("on").notNull().dbDefault(true),
      score: number("score").notNull().dbDefault(0),
    });
    const sqlite = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ flags }), "sqlite"),
    );
    const postgres = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ flags }), "postgres"),
    );

    expect(sqlite).toContain("DEFAULT 1");
    expect(sqlite).toContain("DEFAULT 0");
    expect(postgres).toContain("DEFAULT true");
    expect(postgres).toContain("DEFAULT 0");
  });

  test("does not warn when a unique column uses a SQL expression default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      token: string("token")
        .notNull()
        .unique()
        .dbDefault("gen_random_uuid()", { as: "sql" }),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).not.toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("warns when adding a primary key column with a constant default", () => {
    const before = defineTable("users", {
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      id: string("id").primaryKey().notNull().dbDefault("fixed"),
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

    expect(sql).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("dropping a table emits dropTable and DROP TABLE SQL", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users }),
      emptySchema(),
      "sqlite",
      { strictAddColumn: false },
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops).toEqual([
      {
        kind: "dropTable",
        table: expect.objectContaining({ name: "users" }),
      },
    ]);
    expect(sql).toContain('DROP TABLE "users"');
  });

  test("up and down of a create table are inverses for sqlite", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });
    const to = snapshotSchema({ users });
    const up = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), to, "sqlite"),
    );
    const down = renderMigrationSql(
      "sqlite",
      diffSchemas(to, emptySchema(), "sqlite", { strictAddColumn: false }),
    );

    expect(up).toContain('CREATE TABLE "users"');
    expect(down).toContain('DROP TABLE "users"');
  });

  test("sqlite recreate preserves shared columns when adding a unique column", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
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
      'INSERT INTO "users__semola_tmp" ("id", "name", "email") SELECT "id", "name", "email" FROM "users"',
    );
  });

  test("postgres drops inbound FKs then the parent when the child keeps the column", () => {
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
    const dropFkAt = sql.indexOf('DROP CONSTRAINT "posts_author_id_fkey"');
    const dropAuthorsAt = sql.indexOf('DROP TABLE "authors"');

    expect(dropFkAt).toBeGreaterThanOrEqual(0);
    expect(dropAuthorsAt).toBeGreaterThan(dropFkAt);
  });

  test("quotes identifier-unsafe table and column names", () => {
    const weird = defineTable("user data", {
      id: uuid("user id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ weird }), "sqlite"),
    );

    expect(sql).toContain('CREATE TABLE "user data"');
    expect(sql).toContain('"user id"');
  });

  test("strictAddColumn false allows down paths that re-add NOT NULL without default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: after }),
        snapshotSchema({ users: before }),
        "sqlite",
      ),
    ).toThrow("Cannot add NOT NULL column");

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: after }),
        snapshotSchema({ users: before }),
        "sqlite",
        { strictAddColumn: false },
      ),
    ).not.toThrow();
  });

  test("changing only a foreign key target emits drop and add foreign key on postgres", () => {
    const authors = defineTable("authors", {
      id: uuid("id").primaryKey().notNull(),
    });
    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
    });
    const postsBefore = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => authors.columns.id),
    });
    const postsAfter = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id").references(() => people.columns.id),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ authors, people, posts: postsBefore }),
        snapshotSchema({ authors, people, posts: postsAfter }),
        "postgres",
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "posts_author_id_fkey"');
    expect(sql).toContain('ADD CONSTRAINT "posts_author_id_fkey"');
    expect(sql).toContain('REFERENCES "people" ("id")');
    expect(sql).not.toContain("ALTER COLUMN");
  });

  test("snapshotSchema of an empty tables object matches emptySchema", () => {
    expect(snapshotSchema({})).toEqual(emptySchema());
  });

  test("postgres maps non-pk numbers to DOUBLE PRECISION", () => {
    const items = defineTable("items", {
      id: uuid("id").primaryKey().notNull(),
      price: number("price").notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ items }), "postgres"),
    );

    expect(sql).toContain('"price" DOUBLE PRECISION NOT NULL');
  });

  test("boolean false dbDefault renders for both adapters", () => {
    const flags = defineTable("flags", {
      id: uuid("id").primaryKey().notNull(),
      on: boolean("on").notNull().dbDefault(false),
    });
    const sqlite = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ flags }), "sqlite"),
    );
    const postgres = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ flags }), "postgres"),
    );

    expect(sqlite).toContain("DEFAULT 0");
    expect(postgres).toContain("DEFAULT false");
  });

  test("sqlite warns when adding a unique column with a constant default", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique().dbDefault("x"),
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
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("postgres create table emits a table-level constraint for composite primary keys", () => {
    const members = defineTable("members", {
      orgId: uuid("org_id").primaryKey().notNull(),
      userId: uuid("user_id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ members }), "postgres"),
    );

    expect(sql).toContain(
      'CONSTRAINT "members_pkey" PRIMARY KEY ("org_id", "user_id")',
    );
  });

  test("dropping multiple tables warns about data loss", () => {
    const a = defineTable("a", {
      id: uuid("id").primaryKey().notNull(),
    });
    const b = defineTable("b", {
      id: uuid("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(snapshotSchema({ a, b }), emptySchema(), "sqlite", {
        strictAddColumn: false,
      }),
    );

    expect(sql).toContain("-- warning: drops table(s)");
    expect(sql).toContain("a");
    expect(sql).toContain("b");
    expect(sql).toContain("data in those tables will be lost");
  });

  test("postgres uuid primary key uses UUID type on create", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ users }), "postgres"),
    );

    expect(sql).toContain(
      '"id" UUID CONSTRAINT "users_pkey" PRIMARY KEY NOT NULL',
    );
  });

  test("sqlite enum check updates recreate the table", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live"]).notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["draft", "live", "archived"]).notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("up and down of a create table are inverses for postgres", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });
    const to = snapshotSchema({ users });
    const up = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), to, "postgres"),
    );
    const down = renderMigrationSql(
      "postgres",
      diffSchemas(to, emptySchema(), "postgres", { strictAddColumn: false }),
    );

    expect(up).toContain('CREATE TABLE "users"');
    expect(down).toContain('DROP TABLE "users"');
  });

  test("snapshots sqlType uuid separately from type string", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });
    const columns = snapshotSchema({ users }).tables.users?.columns;

    expect(columns?.id?.type).toBe("string");
    expect(columns?.id?.sqlType).toBe("uuid");
    expect(columns?.name?.sqlType).toBeUndefined();
  });

  test("postgres drops a foreign key without dropping the column", () => {
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
        snapshotSchema({ authors, posts: postsAfter }),
        "postgres",
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "posts_author_id_fkey"');
    expect(sql).not.toContain('DROP COLUMN "author_id"');
    expect(sql).not.toContain('DROP TABLE "authors"');
  });

  test("sqlite recreate copies shared columns when dropping a foreign key", () => {
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
      authorId: uuid("author_id"),
      title: string("title"),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ authors, posts: postsAfter }),
        "sqlite",
      ),
    );

    expect(sql).toContain("posts__semola_tmp");
    expect(sql).toContain(
      'INSERT INTO "posts__semola_tmp" ("id", "author_id", "title") SELECT "id", "author_id", "title" FROM "posts"',
    );
    expect(sql).not.toContain('REFERENCES "authors"');
  });

  test("postgres refuses adding a NOT NULL column without a default", () => {
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
        "postgres",
      ),
    ).toThrow("Cannot add NOT NULL column users.name without .dbDefault");
  });

  test("sqlite recreates the table when dropping a unique constraint", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("postgres number primary keys use DOUBLE PRECISION", () => {
    const items = defineTable("items", {
      id: number("id").primaryKey().notNull(),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(emptySchema(), snapshotSchema({ items }), "postgres"),
    );

    expect(sql).toContain(
      '"id" DOUBLE PRECISION CONSTRAINT "items_pkey" PRIMARY KEY NOT NULL',
    );
  });

  test("sqlite ordered create keeps parent tables before children with FKs", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const posts = defineTable("posts", {
      id: uuid("id").primaryKey().notNull(),
      authorId: uuid("author_id")
        .notNull()
        .references(() => users.columns.id),
    });
    const sql = renderMigrationSql(
      "sqlite",
      diffSchemas(emptySchema(), snapshotSchema({ posts, users }), "sqlite"),
    );
    const usersAt = sql.indexOf('CREATE TABLE "users"');
    const postsAt = sql.indexOf('CREATE TABLE "posts"');

    expect(usersAt).toBeGreaterThanOrEqual(0);
    expect(postsAt).toBeGreaterThan(usersAt);
  });

  test("warns for column rename as drop and add on postgres too", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      about: string("about"),
    });
    const sql = renderMigrationSql(
      "postgres",
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        "postgres",
      ),
    );

    expect(sql).toContain('-- warning: "users" drops bio and adds about');
  });

  test("sqlite drops and recreates when removing a primary key column", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const after = defineTable("users", {
      email: string("email").primaryKey().notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );
    const sql = renderMigrationSql("sqlite", ops);

    expect(ops.some((op) => op.kind === "recreateTable")).toBe(true);
    expect(sql).toContain("users__semola_tmp");
    expect(sql).toContain(
      'INSERT INTO "users__semola_tmp" ("email") SELECT "email" FROM "users"',
    );
    expect(sql).toContain("PRIMARY KEY");
    expect(sql).toContain('"email"');
    expect(sql).not.toContain('"id"');
  });

  test("adding a table and dropping another warns and emits both ops", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
    });
    const ops = diffSchemas(
      snapshotSchema({ users }),
      snapshotSchema({ people }),
      "sqlite",
    );

    expect(ops.map((op) => op.kind).sort()).toEqual([
      "createTable",
      "dropTable",
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { check } from "../checks/index.js";
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
import { index, uniqueIndex } from "../indexes/index.js";
import { defineTable } from "../table/index.js";
import { getMigrationDialect } from "./dialect/index.js";
import { diffSchemas } from "./diff.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import { assertSchemaSnapshot } from "./sql.js";
import type { SchemaSnapshot } from "./types.js";

describe("orm migrations snapshot/diff/sql", () => {
  test("snapshots tables and columns", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique().dbDefault("x"),
      },
    });

    const snapshot = snapshotSchema({ users });

    expect(snapshot.tables.users?.columns.id?.sqlType).toBe("uuid");
    expect(snapshot.tables.users?.columns.email?.isUnique).toBe(true);
    expect(snapshot.tables.users?.columns.email?.dbDefault).toBe("'x'");
  });

  test("diffs create table and renders sqlite sql", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull().unique(),
      },
    });

    const to = snapshotSchema({ users });
    const ops = diffSchemas(emptySchema(), to, getMigrationDialect("sqlite"));
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe("createTable");
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain(
      '"id" TEXT CONSTRAINT "users_pkey" PRIMARY KEY NOT NULL',
    );
    expect(sql).toContain(
      '"email" TEXT NOT NULL CONSTRAINT "users_email_key" UNIQUE',
    );

    const down = getMigrationDialect("sqlite").render(
      diffSchemas(to, emptySchema(), getMigrationDialect("sqlite"), {
        strictAddColumn: false,
      }),
    );

    expect(down).toContain('DROP TABLE "users"');
  });

  test("renders postgres uuid and types", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });

    const to = snapshotSchema({ users });
    const ops = diffSchemas(emptySchema(), to, getMigrationDialect("postgres"));
    const sql = getMigrationDialect("postgres").render(ops);

    expect(sql).toContain(
      '"id" UUID CONSTRAINT "users_pkey" PRIMARY KEY NOT NULL',
    );
  });

  test("sqlite adds nullable columns in place", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bio: string("bio"),
      },
    });

    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    ).toThrow("Cannot add NOT NULL column users.name without .dbDefault");
  });

  test("sqlite recreates table on column default change and copies rows", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: string("age").notNull(),
      },
    });
    const afterUsers = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: string("age").notNull().dbDefault("0"),
      },
    });

    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: afterUsers }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops[0]?.kind).toBe("recreateTable");
    expect(sql).toContain(
      'INSERT INTO "users__semola_tmp" ("id", "age") SELECT "id", "age" FROM "users"',
    );
    expect(sql).toContain('DROP TABLE "users"');
    expect(sql).toContain('RENAME TO "users"');
  });

  test("emits a table-level primary key for composite keys", () => {
    const members = defineTable({
      sqlName: "members",
      columns: {
        orgId: uuid("org_id").primaryKey().notNull(),
        userId: uuid("user_id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ members }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain(
      'CONSTRAINT "members_pkey" PRIMARY KEY ("org_id", "user_id")',
    );
    expect(sql).not.toContain(
      '"org_id" TEXT CONSTRAINT "members_pkey" PRIMARY KEY',
    );
  });

  test("sqlite maps integer primary keys to INTEGER and other numbers to REAL", () => {
    const items = defineTable({
      sqlName: "items",
      columns: {
        id: number("id").primaryKey().notNull(),
        price: number("price").notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ items }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain(
      '"id" INTEGER CONSTRAINT "items_pkey" PRIMARY KEY NOT NULL',
    );
    expect(sql).toContain('"price" REAL NOT NULL');
  });

  test("sqlite recreates the table when dropping a unique or primary key column", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("orders create table before add-column foreign keys", () => {
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });

    const ops = diffSchemas(
      snapshotSchema({ posts: postsBefore }),
      snapshotSchema({ authors, posts: postsAfter }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);
    const createAt = sql.indexOf('CREATE TABLE "authors"');
    const addAt = sql.indexOf("ADD COLUMN");

    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(addAt).toBeGreaterThan(createAt);
    expect(sql.indexOf("ADD CONSTRAINT")).toBeGreaterThan(addAt);
    expect(sql).toContain(
      'ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors" ("id")',
    );
  });

  test("postgres drops foreign keys before dropping referenced tables", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id"),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ posts: postsAfter }),
        getMigrationDialect("postgres"),
      ),
    );
    const dropFkAt = sql.indexOf("DROP CONSTRAINT");
    const dropAuthorsAt = sql.indexOf('DROP TABLE "authors"');

    expect(dropFkAt).toBeGreaterThanOrEqual(0);
    expect(dropAuthorsAt).toBeGreaterThan(dropFkAt);
  });

  test("postgres creates referenced table before adding a foreign key", () => {
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id"),
      },
    });
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: postsBefore }),
        snapshotSchema({ authors, posts: postsAfter }),
        getMigrationDialect("postgres"),
      ),
    );

    const createAuthorsAt = sql.indexOf('CREATE TABLE "authors"');
    const addFkAt = sql.indexOf('ADD CONSTRAINT "posts_author_id_fkey"');

    expect(createAuthorsAt).toBeGreaterThanOrEqual(0);
    expect(addFkAt).toBeGreaterThan(createAuthorsAt);
  });

  test("postgres adds new-table foreign keys after parent column type changes", () => {
    const authorsBefore = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const authorsAfter = defineTable({
      sqlName: "authors",
      columns: {
        id: string("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: string("author_id").references(() => authorsAfter.columns.id),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ authors: authorsBefore }),
        snapshotSchema({ authors: authorsAfter, posts }),
        getMigrationDialect("postgres"),
      ),
    );
    const typeAt = sql.indexOf("TYPE TEXT");
    const addFkAt = sql.indexOf('ADD CONSTRAINT "posts_author_id_fkey"');
    const createPostsAt = sql.indexOf('CREATE TABLE "posts"');
    const createPostsEnd = sql.indexOf(";", createPostsAt);

    expect(typeAt).toBeGreaterThanOrEqual(0);
    expect(addFkAt).toBeGreaterThan(typeAt);
    expect(createPostsAt).toBeGreaterThanOrEqual(0);
    expect(sql.slice(createPostsAt, createPostsEnd)).not.toContain(
      "REFERENCES",
    );
  });

  test("postgres adds new-table foreign keys after a new parent unique column exists", () => {
    const usersBefore = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const usersAfter = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique().dbDefault("x"),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").references(() => usersAfter.columns.email),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: usersBefore }),
        snapshotSchema({ users: usersAfter, posts }),
        getMigrationDialect("postgres"),
      ),
    );
    const addColumnAt = sql.indexOf('ADD COLUMN "email"');
    const addFkAt = sql.indexOf('ADD CONSTRAINT "posts_email_fkey"');

    expect(addColumnAt).toBeGreaterThanOrEqual(0);
    expect(addFkAt).toBeGreaterThan(addColumnAt);
  });

  test("postgres adds new-table foreign keys after unique-to-primary-key on the parent", () => {
    const usersBefore = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").notNull().unique(),
      },
    });
    const usersAfter = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: string("author_id").references(() => usersAfter.columns.id),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: usersBefore }),
        snapshotSchema({ users: usersAfter, posts }),
        getMigrationDialect("postgres"),
      ),
    );
    const addPkAt = sql.indexOf('ADD CONSTRAINT "users_pkey"');
    const addFkAt = sql.indexOf('ADD CONSTRAINT "posts_author_id_fkey"');

    expect(addPkAt).toBeGreaterThanOrEqual(0);
    expect(addFkAt).toBeGreaterThan(addPkAt);
  });

  test("sqlite recreates a child table before dropping its parent", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
        title: string("title"),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        title: string("title").notNull().dbDefault(""),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ posts: postsAfter }),
        getMigrationDialect("sqlite"),
      ),
    );
    const recreateAt = sql.indexOf("posts__semola_tmp");
    const dropAuthorsAt = sql.indexOf('DROP TABLE "authors"');

    expect(recreateAt).toBeGreaterThanOrEqual(0);
    expect(dropAuthorsAt).toBeGreaterThan(recreateAt);
  });

  test("postgres add-column primary key adds the constraint after the column", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id")
          .primaryKey()
          .notNull()
          .dbDefault("gen_random_uuid()", { as: "sql" }),
        email: string("email").notNull().unique(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: string("id"),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );
    const dropConstraintAt = sql.indexOf("DROP CONSTRAINT");
    const dropNotNullAt = sql.indexOf("DROP NOT NULL");

    expect(dropConstraintAt).toBeGreaterThanOrEqual(0);
    expect(dropNotNullAt).toBeGreaterThan(dropConstraintAt);
  });

  test("postgres drops the old primary key before adding a new one", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        email: string("email").notNull().unique(),
        id: string("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        email: string("email").primaryKey().notNull(),
        id: string("id").notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );
    const dropPkAt = sql.indexOf('DROP CONSTRAINT "users_pkey"');
    const addPkAt = sql.indexOf('ADD CONSTRAINT "users_pkey" PRIMARY KEY');

    expect(dropPkAt).toBeGreaterThanOrEqual(0);
    expect(addPkAt).toBeGreaterThan(dropPkAt);
  });

  test("postgres unique to primary key drops the unique constraint", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").notNull().unique(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('ADD CONSTRAINT "users_id_key" UNIQUE');
    expect(sql).toContain('DROP CONSTRAINT "users_pkey"');
  });

  test("allows self-referential foreign keys", () => {
    let nodes = defineTable({
      sqlName: "nodes",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    nodes = defineTable({
      sqlName: "nodes",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        parentId: uuid("parent_id").references(() => nodes.columns.id),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ nodes }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain('REFERENCES "nodes" ("id")');
  });

  test("postgres creates circular foreign keys after both tables exist", () => {
    let b = defineTable({
      sqlName: "b",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const a = defineTable({
      sqlName: "a",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bId: uuid("b_id").references(() => b.columns.id),
      },
    });
    b = defineTable({
      sqlName: "b",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        aId: uuid("a_id").references(() => a.columns.id),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ a, b }),
        getMigrationDialect("postgres"),
      ),
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
    let b = defineTable({
      sqlName: "b",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const a = defineTable({
      sqlName: "a",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bId: uuid("b_id").references(() => b.columns.id),
      },
    });
    b = defineTable({
      sqlName: "b",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        aId: uuid("a_id").references(() => a.columns.id),
      },
    });

    expect(() =>
      getMigrationDialect("sqlite").render(
        diffSchemas(
          emptySchema(),
          snapshotSchema({ a, b }),
          getMigrationDialect("sqlite"),
        ),
      ),
    ).toThrow("Circular foreign keys between new tables are not supported");
  });

  test("postgres drops inbound foreign keys before altering a referenced column type", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const authorsAfter = defineTable({
      sqlName: "authors",
      columns: {
        id: string("id").primaryKey().notNull(),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: string("author_id").references(() => authorsAfter.columns.id),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ authors, posts }),
        snapshotSchema({ authors: authorsAfter, posts: postsAfter }),
        getMigrationDialect("postgres"),
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
    const before = defineTable({
      sqlName: "members",
      columns: {
        orgId: uuid("org_id").primaryKey().notNull(),
        userId: uuid("user_id").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "members",
      columns: {
        orgId: uuid("org_id").primaryKey().notNull(),
        userId: uuid("user_id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ members: before }),
        snapshotSchema({ members: after }),
        getMigrationDialect("postgres"),
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
    const before = defineTable({
      sqlName: "members",
      columns: {
        orgId: uuid("org_id").primaryKey().notNull(),
        userId: uuid("user_id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "members",
      columns: {
        orgId: uuid("org_id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ members: before }),
        snapshotSchema({ members: after }),
        getMigrationDialect("postgres"),
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
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const people = defineTable({
      sqlName: "people",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users }),
        snapshotSchema({ people }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain(
      "-- warning: drops table(s) users and creates people; data in dropped tables will be lost",
    );
  });

  test("warns when a table is dropped without a matching create", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users }),
        emptySchema(),
        getMigrationDialect("sqlite"),
        {
          strictAddColumn: false,
        },
      ),
    );

    expect(sql).toContain(
      "-- warning: drops table(s) users; data in those tables will be lost",
    );
  });

  test("warns when adding a unique column with a constant default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique().dbDefault("x"),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("warns when adding a unique column with a scientific-notation default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        score: number("score")
          .notNull()
          .unique()
          .dbDefault("1e3", { as: "sql" }),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops[0]?.kind).toBe("recreateTable");
    expect(sql).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("warns when postgres sets NOT NULL on an existing column", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('ALTER COLUMN "email" SET NOT NULL');
    expect(sql).toContain(
      'ALTER COLUMN "users"."email" SET NOT NULL fails if existing rows contain NULL',
    );
  });

  test("warns when sqlite recreates a table to tighten nullability", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().dbDefault(""),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain(
      'recreate "users"."email" as NOT NULL fails if existing rows contain NULL',
    );
  });

  test("warns when down SQL re-adds a NOT NULL column without a default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const down = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: after }),
        snapshotSchema({ users: before }),
        getMigrationDialect("sqlite"),
        { strictAddColumn: false },
      ),
    );

    expect(down).toContain(
      'ADD COLUMN "users"."name" NOT NULL without default fails if the table has rows',
    );
  });

  test("updates postgres enum check constraints", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]).notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live", "archived"]).notNull(),
      },
    });

    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "users_status_check"');
    expect(sql).toContain('ADD CONSTRAINT "users_status_check"');
    expect(sql).toContain("'archived'");
    expect(sql).not.toContain("ALTER COLUMN");
    expect(sql).not.toContain(
      "enum CHECK fails if existing rows have values outside",
    );
  });

  test("postgres type changes use USING CAST", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: string("age").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: number("age").notNull(),
      },
    });

    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      'ALTER COLUMN "age" TYPE DOUBLE PRECISION USING CAST("age" AS DOUBLE PRECISION)',
    );
  });

  test("sqlite recreate casts columns when types change", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: string("age").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: number("age").notNull(),
      },
    });

    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain(
      'INSERT INTO "users__semola_tmp" ("id", "age") SELECT "id", CAST("age" AS REAL) FROM "users"',
    );
    expect(sql).toContain('CONSTRAINT "users_pkey"');
    expect(sql).not.toContain("users__semola_tmp_pkey");
  });

  test("postgres drops defaults before TYPE then sets the new default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: string("age").notNull().dbDefault("0"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: number("age").notNull().dbDefault(1),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]).notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: number("status").notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
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
          indexes: {},
          checks: {},
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
              indexes: {},
              checks: {},
            },
          },
        },
        "schema.json",
      ),
    ).toThrow("references missing table users");
  });

  test("snapshots foreign keys", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id")
          .notNull()
          .references(() => users.columns.id),
      },
    });

    const snapshot = snapshotSchema({ users, posts });

    expect(snapshot.tables.posts?.columns.author_id?.references).toEqual({
      table: "users",
      column: "id",
    });
  });

  test("throws when a foreign key target is not in the schema", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id")
          .notNull()
          .references(() => users.columns.id),
      },
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "not in createOrm({ tables })",
    );
  });

  test("throws when a foreign key type does not match its target", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id")
          .notNull()
          .references(() => users.columns.id),
      },
    });

    expect(() => snapshotSchema({ users, posts })).toThrow(
      "posts.author_id type uuid does not match referenced users.id type string",
    );
  });

  test("quotes JS dbDefault values and passes as: sql through", () => {
    const quoted = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull().dbDefault("'anon'", { as: "sql" }),
      },
    });
    const bare = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull().dbDefault("anon"),
      },
    });
    const apostrophe = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull().dbDefault("it's"),
      },
    });
    const generated = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull().dbDefault("gen_random_uuid()", {
          as: "sql",
        }),
      },
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

    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users: generated }),
        getMigrationDialect("postgres"),
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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bio: string("bio"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        about: string("about"),
      },
    });

    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain('-- warning: "users" drops bio and adds about');
  });

  test("renders json, jsonb, boolean, and date types", () => {
    const events = defineTable({
      sqlName: "events",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        ok: boolean("ok").notNull(),
        at: date("at").notNull(),
        meta: json("meta"),
        extra: jsonb("extra"),
      },
    });
    const sqlite = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ events }),
        getMigrationDialect("sqlite"),
      ),
    );
    const postgres = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ events }),
        getMigrationDialect("postgres"),
      ),
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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull().dbDefault("member"),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops[0]?.kind).toBe("addColumn");
    expect(sql).toContain("ADD COLUMN \"role\" TEXT NOT NULL DEFAULT 'member'");
    expect(sql).not.toContain("users__semola_tmp");
  });

  test("sqlite recreates the table when adding a column with a non-constant default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        createdAt: string("created_at")
          .notNull()
          .dbDefault("CURRENT_TIMESTAMP", { as: "sql" }),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops[0]?.kind).toBe("recreateTable");
    expect(sql).toContain("CURRENT_TIMESTAMP");
    expect(sql).toContain("users__semola_tmp");
    expect(sql).not.toContain("ADD COLUMN");
  });

  test("postgres reference-only changes emit foreign key ops, not ALTER COLUMN", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id"),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ authors, posts: postsAfter }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('ADD CONSTRAINT "posts_author_id_fkey"');
    expect(sql).not.toContain("ALTER COLUMN");
  });

  test("sqlite recreates table for reference-only foreign key changes", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id"),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ authors, posts: postsBefore }),
      snapshotSchema({ authors, posts: postsAfter }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops.some((op) => op.kind === "recreateTable")).toBe(true);
    expect(sql).toContain("posts__semola_tmp");
    expect(sql).toContain('REFERENCES "authors" ("id")');
  });

  test("postgres drops and sets defaults without a type change", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull().dbDefault("a"),
      },
    });
    const dropped = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull(),
      },
    });
    const replaced = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull().dbDefault("b"),
      },
    });

    expect(
      getMigrationDialect("postgres").render(
        diffSchemas(
          snapshotSchema({ users: before }),
          snapshotSchema({ users: dropped }),
          getMigrationDialect("postgres"),
        ),
      ),
    ).toContain('ALTER COLUMN "role" DROP DEFAULT');
    expect(
      getMigrationDialect("postgres").render(
        diffSchemas(
          snapshotSchema({ users: dropped }),
          snapshotSchema({ users: replaced }),
          getMigrationDialect("postgres"),
        ),
      ),
    ).toContain("SET DEFAULT 'b'");
  });

  test("postgres toggles nullability and unique constraints", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('ALTER COLUMN "email" SET NOT NULL');
    expect(sql).toContain('ADD CONSTRAINT "users_email_key" UNIQUE');
  });

  test("throws when adding a foreign key without a target", () => {
    expect(() =>
      getMigrationDialect("postgres").render([
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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bio: string("bio"),
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bio: string("bio"),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
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
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const snapshot = snapshotSchema({ users });

    expect(
      diffSchemas(snapshot, snapshot, getMigrationDialect("sqlite")),
    ).toEqual([]);
    expect(
      diffSchemas(snapshot, snapshot, getMigrationDialect("postgres")),
    ).toEqual([]);
  });

  test("snapshots enum values and nullability", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]),
        bio: string("bio"),
      },
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
    const events = defineTable({
      sqlName: "events",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        ok: boolean("ok").notNull(),
        at: date("at").notNull(),
        meta: json("meta"),
        extra: jsonb("extra"),
        score: number("score").notNull(),
      },
    });
    const columns = snapshotSchema({ events }).tables.events?.columns;

    expect(columns?.ok?.type).toBe("boolean");
    expect(columns?.at?.type).toBe("date");
    expect(columns?.meta?.type).toBe("json");
    expect(columns?.extra?.type).toBe("jsonb");
    expect(columns?.score?.type).toBe("number");
  });

  test("renders enum check constraints on create table", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]).notNull(),
      },
    });
    const sqlite = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users }),
        getMigrationDialect("sqlite"),
      ),
    );
    const postgres = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sqlite).toContain('CONSTRAINT "users_status_check"');
    expect(sqlite).toContain("'draft'");
    expect(sqlite).toContain("'live'");
    expect(postgres).toContain('CONSTRAINT "users_status_check"');
    expect(postgres).toContain("'draft'");
    expect(postgres).toContain("'live'");
  });

  test("narrowing an enum updates the check constraint", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live", "archived"]).notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]).notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "users_status_check"');
    expect(sql).toContain('ADD CONSTRAINT "users_status_check"');
    expect(sql).toContain("'draft'");
    expect(sql).toContain("'live'");
    expect(sql).not.toContain("'archived'");
    expect(sql).toContain(
      'ALTER COLUMN "users"."status" enum CHECK fails if existing rows have values outside draft, live',
    );
  });

  test("warns when a string column becomes an enum", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: string("status").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]).notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      'ALTER COLUMN "users"."status" enum CHECK fails if existing rows have values outside draft, live',
    );
  });

  test("allows adding a NOT NULL column when a default is present", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull().dbDefault("anon"),
      },
    });

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    ).not.toThrow();
    expect(() =>
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    ).not.toThrow();
  });

  test("sqlite drops a nullable column in place", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bio: string("bio"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

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
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bio: string("bio"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('DROP COLUMN "bio"');
  });

  test("sqlite recreates the table on type changes", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: string("age").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        age: number("age").notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("sqlite recreates the table when toggling nullability", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().dbDefault(""),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("sqlite recreates the table when adding a unique constraint", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("postgres drops a unique constraint without altering the column type", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "users_email_key"');
    expect(sql).not.toContain("ALTER COLUMN");
  });

  test("creates multiple tables without foreign keys in any stable order", () => {
    const a = defineTable({
      sqlName: "a",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const b = defineTable({
      sqlName: "b",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ a, b }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain('CREATE TABLE "a"');
    expect(sql).toContain('CREATE TABLE "b"');
  });

  test("inline foreign keys appear on create table for both adapters", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id")
          .notNull()
          .references(() => users.columns.id),
      },
    });
    const sqlite = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users, posts }),
        getMigrationDialect("sqlite"),
      ),
    );
    const postgres = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users, posts }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sqlite).toContain('REFERENCES "users" ("id")');
    expect(postgres).toContain('REFERENCES "users" ("id")');
  });

  test("postgres SET NOT NULL comes before adding a unique constraint", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );
    const notNullAt = sql.indexOf("SET NOT NULL");
    const uniqueAt = sql.indexOf('ADD CONSTRAINT "users_email_key" UNIQUE');

    expect(notNullAt).toBeGreaterThanOrEqual(0);
    expect(uniqueAt).toBeGreaterThan(notNullAt);
  });

  test("postgres DROP NOT NULL follows dropping a unique constraint", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email"),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );
    const dropUniqueAt = sql.indexOf('DROP CONSTRAINT "users_email_key"');
    const dropNotNullAt = sql.indexOf("DROP NOT NULL");

    expect(dropUniqueAt).toBeGreaterThanOrEqual(0);
    expect(dropNotNullAt).toBeGreaterThan(dropUniqueAt);
  });

  test("json scalar dbDefaults emit valid JSON for both adapters", () => {
    const events = defineTable({
      sqlName: "events",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        label: json("label").notNull().dbDefault("anon"),
        extra: jsonb("extra").notNull().dbDefault("anon"),
      },
    });
    const sqlite = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ events }),
        getMigrationDialect("sqlite"),
      ),
    );
    const postgres = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ events }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sqlite).toContain(`DEFAULT '"anon"'`);
    expect(postgres).toContain(`DEFAULT '"anon"'`);

    const snapshot = snapshotSchema({ events });
    const labelDefault = snapshot.tables.events?.columns.label?.dbDefault;
    const extraDefault = snapshot.tables.events?.columns.extra?.dbDefault;

    if (!labelDefault) {
      throw new Error("missing label dbDefault");
    }

    if (!extraDefault) {
      throw new Error("missing extra dbDefault");
    }

    expect(JSON.parse(labelDefault.slice(1, -1).replaceAll("''", "'"))).toBe(
      "anon",
    );
    expect(JSON.parse(extraDefault.slice(1, -1).replaceAll("''", "'"))).toBe(
      "anon",
    );
  });

  test("boolean and number dbDefaults render correctly", () => {
    const flags = defineTable({
      sqlName: "flags",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        on: boolean("on").notNull().dbDefault(true),
        score: number("score").notNull().dbDefault(0),
      },
    });
    const sqlite = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ flags }),
        getMigrationDialect("sqlite"),
      ),
    );
    const postgres = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ flags }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sqlite).toContain("DEFAULT 1");
    expect(sqlite).toContain("DEFAULT 0");
    expect(postgres).toContain("DEFAULT true");
    expect(postgres).toContain("DEFAULT 0");
  });

  test("does not warn when a unique column uses a SQL expression default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        token: string("token")
          .notNull()
          .unique()
          .dbDefault("gen_random_uuid()", { as: "sql" }),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).not.toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("warns when adding a primary key column with a constant default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: string("id").primaryKey().notNull().dbDefault("fixed"),
        email: string("email").notNull().unique(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("dropping a table emits dropTable and DROP TABLE SQL", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users }),
      emptySchema(),
      getMigrationDialect("sqlite"),
      { strictAddColumn: false },
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops).toEqual([
      {
        kind: "dropTable",
        table: expect.objectContaining({ name: "users" }),
      },
    ]);
    expect(sql).toContain('DROP TABLE "users"');
  });

  test("up and down of a create table are inverses for sqlite", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });
    const to = snapshotSchema({ users });
    const up = getMigrationDialect("sqlite").render(
      diffSchemas(emptySchema(), to, getMigrationDialect("sqlite")),
    );
    const down = getMigrationDialect("sqlite").render(
      diffSchemas(to, emptySchema(), getMigrationDialect("sqlite"), {
        strictAddColumn: false,
      }),
    );

    expect(up).toContain('CREATE TABLE "users"');
    expect(down).toContain('DROP TABLE "users"');
  });

  test("sqlite recreate preserves shared columns when adding a unique column", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain(
      'INSERT INTO "users__semola_tmp" ("id", "name", "email") SELECT "id", "name", "email" FROM "users"',
    );
  });

  test("postgres drops inbound FKs then the parent when the child keeps the column", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id"),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ posts: postsAfter }),
        getMigrationDialect("postgres"),
      ),
    );
    const dropFkAt = sql.indexOf('DROP CONSTRAINT "posts_author_id_fkey"');
    const dropAuthorsAt = sql.indexOf('DROP TABLE "authors"');

    expect(dropFkAt).toBeGreaterThanOrEqual(0);
    expect(dropAuthorsAt).toBeGreaterThan(dropFkAt);
  });

  test("quotes identifier-unsafe table and column names", () => {
    const weird = defineTable({
      sqlName: "user data",
      columns: {
        id: uuid("user id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ weird }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain('CREATE TABLE "user data"');
    expect(sql).toContain('"user id"');
  });

  test("strictAddColumn false allows down paths that re-add NOT NULL without default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: after }),
        snapshotSchema({ users: before }),
        getMigrationDialect("sqlite"),
      ),
    ).toThrow("Cannot add NOT NULL column");

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: after }),
        snapshotSchema({ users: before }),
        getMigrationDialect("sqlite"),
        { strictAddColumn: false },
      ),
    ).not.toThrow();
  });

  test("changing only a foreign key target emits drop and add foreign key on postgres", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const people = defineTable({
      sqlName: "people",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => people.columns.id),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ authors, people, posts: postsBefore }),
        snapshotSchema({ authors, people, posts: postsAfter }),
        getMigrationDialect("postgres"),
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
    const items = defineTable({
      sqlName: "items",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        price: number("price").notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ items }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('"price" DOUBLE PRECISION NOT NULL');
  });

  test("boolean false dbDefault renders for both adapters", () => {
    const flags = defineTable({
      sqlName: "flags",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        on: boolean("on").notNull().dbDefault(false),
      },
    });
    const sqlite = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ flags }),
        getMigrationDialect("sqlite"),
      ),
    );
    const postgres = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ flags }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sqlite).toContain("DEFAULT 0");
    expect(postgres).toContain("DEFAULT false");
  });

  test("sqlite warns when adding a unique column with a constant default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique().dbDefault("x"),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain(
      "unique/primary key with a constant default fails if the table has more than one row",
    );
  });

  test("postgres create table emits a table-level constraint for composite primary keys", () => {
    const members = defineTable({
      sqlName: "members",
      columns: {
        orgId: uuid("org_id").primaryKey().notNull(),
        userId: uuid("user_id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ members }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      'CONSTRAINT "members_pkey" PRIMARY KEY ("org_id", "user_id")',
    );
  });

  test("dropping multiple tables warns about data loss", () => {
    const a = defineTable({
      sqlName: "a",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const b = defineTable({
      sqlName: "b",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ a, b }),
        emptySchema(),
        getMigrationDialect("sqlite"),
        {
          strictAddColumn: false,
        },
      ),
    );

    expect(sql).toContain("-- warning: drops table(s)");
    expect(sql).toContain("a");
    expect(sql).toContain("b");
    expect(sql).toContain("data in those tables will be lost");
  });

  test("postgres uuid primary key uses UUID type on create", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      '"id" UUID CONSTRAINT "users_pkey" PRIMARY KEY NOT NULL',
    );
  });

  test("sqlite enum check updates recreate the table", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]).notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live", "archived"]).notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("warns when sqlite recreates a table to narrow an enum", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live", "archived"]).notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        status: enumType("status", ["draft", "live"]).notNull(),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain(
      'recreate "users"."status" enum CHECK fails if existing rows have values outside draft, live',
    );
  });

  test("up and down of a create table are inverses for postgres", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });
    const to = snapshotSchema({ users });
    const up = getMigrationDialect("postgres").render(
      diffSchemas(emptySchema(), to, getMigrationDialect("postgres")),
    );
    const down = getMigrationDialect("postgres").render(
      diffSchemas(to, emptySchema(), getMigrationDialect("postgres"), {
        strictAddColumn: false,
      }),
    );

    expect(up).toContain('CREATE TABLE "users"');
    expect(down).toContain('DROP TABLE "users"');
  });

  test("snapshots sqlType uuid separately from type string", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });
    const columns = snapshotSchema({ users }).tables.users?.columns;

    expect(columns?.id?.type).toBe("string");
    expect(columns?.id?.sqlType).toBe("uuid");
    expect(columns?.name?.sqlType).toBeUndefined();
  });

  test("postgres drops a foreign key without dropping the column", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id"),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ authors, posts: postsAfter }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('DROP CONSTRAINT "posts_author_id_fkey"');
    expect(sql).not.toContain('DROP COLUMN "author_id"');
    expect(sql).not.toContain('DROP TABLE "authors"');
  });

  test("sqlite recreate copies shared columns when dropping a foreign key", () => {
    const authors = defineTable({
      sqlName: "authors",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const postsBefore = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").references(() => authors.columns.id),
        title: string("title"),
      },
    });
    const postsAfter = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id"),
        title: string("title"),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ authors, posts: postsBefore }),
        snapshotSchema({ authors, posts: postsAfter }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain("posts__semola_tmp");
    expect(sql).toContain(
      'INSERT INTO "posts__semola_tmp" ("id", "author_id", "title") SELECT "id", "author_id", "title" FROM "posts"',
    );
    expect(sql).not.toContain('REFERENCES "authors"');
  });

  test("postgres refuses adding a NOT NULL column without a default", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        name: string("name").notNull(),
      },
    });

    expect(() =>
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    ).toThrow("Cannot add NOT NULL column users.name without .dbDefault");
  });

  test("sqlite recreates the table when dropping a unique constraint", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );

    expect(ops[0]?.kind).toBe("recreateTable");
  });

  test("postgres number primary keys use DOUBLE PRECISION", () => {
    const items = defineTable({
      sqlName: "items",
      columns: {
        id: number("id").primaryKey().notNull(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ items }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      '"id" DOUBLE PRECISION CONSTRAINT "items_pkey" PRIMARY KEY NOT NULL',
    );
  });

  test("sqlite ordered create keeps parent tables before children with FKs", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id")
          .notNull()
          .references(() => users.columns.id),
      },
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ posts, users }),
        getMigrationDialect("sqlite"),
      ),
    );
    const usersAt = sql.indexOf('CREATE TABLE "users"');
    const postsAt = sql.indexOf('CREATE TABLE "posts"');

    expect(usersAt).toBeGreaterThanOrEqual(0);
    expect(postsAt).toBeGreaterThan(usersAt);
  });

  test("warns for column rename as drop and add on postgres too", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        bio: string("bio"),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        about: string("about"),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ users: before }),
        snapshotSchema({ users: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('-- warning: "users" drops bio and adds about');
  });

  test("sqlite drops and recreates when removing a primary key column", () => {
    const before = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const after = defineTable({
      sqlName: "users",
      columns: {
        email: string("email").primaryKey().notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

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
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const people = defineTable({
      sqlName: "people",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ users }),
      snapshotSchema({ people }),
      getMigrationDialect("sqlite"),
    );

    expect(ops.map((op) => op.kind).sort()).toEqual([
      "createTable",
      "dropTable",
    ]);
  });
});

describe("orm migrations indexes", () => {
  const postsColumns = {
    id: uuid("id").primaryKey().notNull(),
    authorId: uuid("author_id").notNull(),
    slug: string("slug").notNull(),
    createdAt: date("created_at").notNull(),
    deletedAt: date("deleted_at").nullable(),
  };

  test("snapshots indexes on tables", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_author_created_idx").on(
          columns.authorId,
          columns.createdAt,
        ),
        uniqueIndex("posts_slug_idx").on(columns.slug),
      ],
    });
    const snapshot = snapshotSchema({ posts });
    const indexes = snapshot.tables.posts?.indexes;

    expect(Object.keys(indexes ?? {})).toEqual([
      "posts_author_created_idx",
      "posts_slug_idx",
    ]);
    expect(indexes?.posts_author_created_idx).toEqual({
      name: "posts_author_created_idx",
      table: "posts",
      columns: ["author_id", "created_at"],
      unique: false,
    });
    expect(indexes?.posts_slug_idx).toEqual({
      name: "posts_slug_idx",
      table: "posts",
      columns: ["slug"],
      unique: true,
    });
  });

  test("snapshots partial index where clause", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_active_author_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL"),
      ],
    });
    const snapshot = snapshotSchema({ posts });

    expect(snapshot.tables.posts?.indexes.posts_active_author_idx?.where).toBe(
      "deleted_at IS NULL",
    );
  });

  test("tables without indexes snapshot as empty object", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const snapshot = snapshotSchema({ users });

    expect(snapshot.tables.users?.indexes).toEqual({});
  });

  test("postgres createTable is followed by createIndex ops", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_author_idx").on(columns.authorId),
        uniqueIndex("posts_slug_idx").on(columns.slug),
      ],
    });
    const ops = diffSchemas(
      emptySchema(),
      snapshotSchema({ posts }),
      getMigrationDialect("postgres"),
    );

    expect(ops.map((op) => op.kind)).toEqual([
      "createTable",
      "createIndex",
      "createIndex",
    ]);
  });

  test("sqlite createTable is followed by createIndex ops", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const ops = diffSchemas(
      emptySchema(),
      snapshotSchema({ posts }),
      getMigrationDialect("sqlite"),
    );

    expect(ops[0]?.kind).toBe("createTable");
    expect(ops[1]?.kind).toBe("createIndex");
  });

  test("postgres renders CREATE INDEX for composite index", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_author_created_idx").on(
          columns.authorId,
          columns.createdAt,
        ),
      ],
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ posts }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      'CREATE INDEX "posts_author_created_idx"\n  ON "posts" ("author_id", "created_at")',
    );
  });

  test("sqlite renders CREATE UNIQUE INDEX", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [uniqueIndex("posts_slug_idx").on(columns.slug)],
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ posts }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "posts_slug_idx"\n  ON "posts" ("slug")',
    );
  });

  test("postgres renders partial index WHERE clause", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_active_author_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL"),
      ],
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ posts }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      'CREATE INDEX "posts_active_author_idx"\n  ON "posts" ("author_id")\n  WHERE deleted_at IS NULL',
    );
  });

  test("column unique uses CONSTRAINT not CREATE UNIQUE INDEX", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        email: string("email").notNull().unique(),
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ users }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('CONSTRAINT "users_email_key" UNIQUE');
    expect(sql).not.toContain('CREATE UNIQUE INDEX "users_email');
  });

  test("adds index to existing table on postgres", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops).toEqual([{ kind: "createIndex", index: expect.any(Object) }]);
    expect(sql).toContain('CREATE INDEX "posts_author_idx"');
  });

  test("adds index to existing table on sqlite", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [uniqueIndex("posts_slug_idx").on(columns.slug)],
    });
    const sql = getMigrationDialect("sqlite").render(
      diffSchemas(
        snapshotSchema({ posts: before }),
        snapshotSchema({ posts: after }),
        getMigrationDialect("sqlite"),
      ),
    );

    expect(sql).toContain('CREATE UNIQUE INDEX "posts_slug_idx"');
  });

  test("removes index from existing table", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops).toEqual([{ kind: "dropIndex", index: expect.any(Object) }]);
    expect(sql).toContain('DROP INDEX "posts_author_idx"');
  });

  test("changes index columns via drop and create", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_lookup_idx").on(columns.authorId)],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_lookup_idx").on(columns.authorId, columns.createdAt),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops.map((op) => op.kind)).toEqual(["dropIndex", "createIndex"]);
    expect(sql).toContain('DROP INDEX "posts_lookup_idx"');
    expect(sql).toContain(
      'CREATE INDEX "posts_lookup_idx"\n  ON "posts" ("author_id", "created_at")',
    );
  });

  test("changes index where clause via drop and create on postgres", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_active_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_active_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL AND status = 'live'"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops.map((op) => op.kind)).toEqual(["dropIndex", "createIndex"]);
    expect(sql).toContain("WHERE deleted_at IS NULL AND status = 'live'");
  });

  test("sqlite applies changed partial index where clause in place", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_active_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_active_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL AND status = 'live'"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops.map((op) => op.kind)).toEqual(["dropIndex", "createIndex"]);
    expect(sql).toContain("WHERE deleted_at IS NULL AND status = 'live'");
  });

  test("toggles index unique flag via drop and create", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_slug_idx").on(columns.slug)],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [uniqueIndex("posts_slug_idx").on(columns.slug)],
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: before }),
        snapshotSchema({ posts: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain('DROP INDEX "posts_slug_idx"');
    expect(sql).toContain('CREATE UNIQUE INDEX "posts_slug_idx"');
  });

  test("drops multiple indexes when removing several", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_author_idx").on(columns.authorId),
        uniqueIndex("posts_slug_idx").on(columns.slug),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.filter((op) => op.kind === "dropIndex")).toHaveLength(2);
  });

  test("dropped table emits dropIndex before dropTable", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_author_idx").on(columns.authorId),
        uniqueIndex("posts_slug_idx").on(columns.slug),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts }),
      emptySchema(),
      getMigrationDialect("postgres"),
      { strictAddColumn: false },
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops.map((op) => op.kind)).toEqual([
      "dropIndex",
      "dropIndex",
      "dropTable",
    ]);
    expect(sql).toContain('DROP INDEX "posts_author_idx"');
    expect(sql).toContain('DROP INDEX "posts_slug_idx"');
    expect(sql.indexOf('DROP INDEX "posts_author_idx"')).toBeLessThan(
      sql.indexOf('DROP TABLE "posts"'),
    );
    expect(sql).toContain('DROP TABLE "posts"');
  });

  test("postgres dropIndex precedes dropColumn for indexed column", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: {
        id: postsColumns.id,
        slug: postsColumns.slug,
        createdAt: postsColumns.createdAt,
        deletedAt: postsColumns.deletedAt,
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: before }),
        snapshotSchema({ posts: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql.indexOf('DROP INDEX "posts_author_idx"')).toBeLessThan(
      sql.indexOf('DROP COLUMN "author_id"'),
    );
  });

  test("sqlite drops index before column when dropping indexed column", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: {
        id: postsColumns.id,
        slug: postsColumns.slug,
        createdAt: postsColumns.createdAt,
        deletedAt: postsColumns.deletedAt,
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("sqlite"),
    );

    expect(ops.map((op) => op.kind)).toEqual(["dropIndex", "dropColumn"]);
  });

  test("sqlite adds multiple indexes to existing table in place", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_author_idx").on(columns.authorId),
        uniqueIndex("posts_slug_idx").on(columns.slug),
        index("posts_active_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops.map((op) => op.kind)).toEqual([
      "createIndex",
      "createIndex",
      "createIndex",
    ]);
    expect(sql).toContain('CREATE INDEX "posts_author_idx"');
    expect(sql).toContain('CREATE UNIQUE INDEX "posts_slug_idx"');
    expect(sql).toContain('CREATE INDEX "posts_active_idx"');
    expect(sql).toContain("WHERE deleted_at IS NULL");
  });

  test("down migration drops indexes when reversing create", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_author_idx").on(columns.authorId),
        uniqueIndex("posts_slug_idx").on(columns.slug),
      ],
    });
    const to = snapshotSchema({ posts });
    const down = getMigrationDialect("postgres").render(
      diffSchemas(to, emptySchema(), getMigrationDialect("postgres"), {
        strictAddColumn: false,
      }),
    );

    expect(down).toContain('DROP INDEX "posts_slug_idx"');
    expect(down).toContain('DROP INDEX "posts_author_idx"');
    expect(down).toContain('DROP TABLE "posts"');
  });

  test("down migration drops index before dropping table on sqlite", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const to = snapshotSchema({ posts });
    const down = getMigrationDialect("sqlite").render(
      diffSchemas(to, emptySchema(), getMigrationDialect("sqlite"), {
        strictAddColumn: false,
      }),
    );
    const dropIndexAt = down.indexOf('DROP INDEX "posts_author_idx"');
    const dropTableAt = down.indexOf('DROP TABLE "posts"');

    expect(dropIndexAt).toBeGreaterThanOrEqual(0);
    expect(dropTableAt).toBeGreaterThan(dropIndexAt);
  });

  test("down migration recreates dropped index", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const down = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: after }),
        snapshotSchema({ posts: before }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(down).toContain('CREATE INDEX "posts_author_idx"');
  });

  test("identical schemas with indexes produce no ops", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const snapshot = snapshotSchema({ posts });

    expect(
      diffSchemas(snapshot, snapshot, getMigrationDialect("postgres")),
    ).toEqual([]);
    expect(
      diffSchemas(snapshot, snapshot, getMigrationDialect("sqlite")),
    ).toEqual([]);
  });

  test("assertSchemaSnapshot accepts indexes field on tables", () => {
    const authorId = "author_id";
    const indexName = "posts_author_idx";
    const schema = {
      tables: {
        posts: {
          name: "posts",
          columns: {
            [authorId]: {
              name: authorId,
              type: "string",
              isNullable: false,
              isPrimaryKey: false,
              isUnique: false,
              sqlType: "uuid",
            },
          },
          indexes: {
            [indexName]: {
              name: indexName,
              table: "posts",
              columns: [authorId],
              unique: false,
            },
          },
          checks: {},
        },
      },
    } satisfies SchemaSnapshot;

    expect(assertSchemaSnapshot(schema, "schema.json")).toEqual(schema);
  });

  test("assertSchemaSnapshot defaults missing indexes to empty object", () => {
    const authorId = "author_id";
    const normalized = assertSchemaSnapshot(
      {
        tables: {
          posts: {
            name: "posts",
            columns: {
              [authorId]: {
                name: authorId,
                type: "string",
                isNullable: false,
                isPrimaryKey: false,
                isUnique: false,
              },
            },
          },
        },
      },
      "schema.json",
    );

    expect(normalized.tables.posts?.indexes).toEqual({});
    expect(normalized.tables.posts?.checks).toEqual({});
    expect(normalized.tables.posts?.columns[authorId]?.name).toBe(authorId);
  });

  test("assertSchemaSnapshot rejects invalid index snapshot", () => {
    expect(() =>
      assertSchemaSnapshot(
        {
          tables: {
            posts: {
              name: "posts",
              columns: {},
              indexes: {
                bad: 1,
              },
            },
          },
        },
        "schema.json",
      ),
    ).toThrow("Invalid schema.json");
  });

  test("createIndex SQL follows createTable SQL on new table", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ posts }),
        getMigrationDialect("postgres"),
      ),
    );
    const createTableAt = sql.indexOf('CREATE TABLE "posts"');
    const createIndexAt = sql.indexOf('CREATE INDEX "posts_author_idx"');

    expect(createTableAt).toBeGreaterThanOrEqual(0);
    expect(createIndexAt).toBeGreaterThan(createTableAt);
  });

  test("new table with multiple indexes emits separate createIndex ops", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [
        index("posts_a_idx").on(columns.authorId),
        index("posts_b_idx").on(columns.slug),
        uniqueIndex("posts_c_idx").on(columns.createdAt),
      ],
    });
    const ops = diffSchemas(
      emptySchema(),
      snapshotSchema({ posts }),
      getMigrationDialect("sqlite"),
    );

    expect(ops.filter((op) => op.kind === "createIndex")).toHaveLength(3);
  });
});

describe("orm migrations checks", () => {
  const postsColumns = {
    id: uuid("id").primaryKey().notNull(),
    authorId: uuid("author_id").notNull(),
    age: number("age"),
    startedAt: date("started_at").notNull(),
    endedAt: date("ended_at").nullable(),
  };

  test("snapshots checks on tables", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const snapshot = snapshotSchema({ posts });
    const checks = snapshot.tables.posts?.checks;

    expect(Object.keys(checks ?? {})).toEqual([
      "posts_age_check",
      "posts_dates_check",
    ]);
    expect(checks?.posts_age_check).toEqual({
      name: "posts_age_check",
      table: "posts",
      expression: "age > 21",
      columns: ["age"],
    });
    expect(checks?.posts_dates_check?.columns).toEqual([
      "started_at",
      "ended_at",
    ]);
  });

  test("tables without checks snapshot as empty object", () => {
    const users = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });
    const snapshot = snapshotSchema({ users });

    expect(snapshot.tables.users?.checks).toEqual({});
  });

  test("new table renders checks inline in CREATE TABLE", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const ops = diffSchemas(
      emptySchema(),
      snapshotSchema({ posts }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops.map((op) => op.kind)).toEqual(["createTable"]);
    expect(sql).toContain('CONSTRAINT "posts_age_check" CHECK (age > 21)');
    expect(sql).toContain(
      'CONSTRAINT "posts_dates_check" CHECK (started_at < ended_at)',
    );
  });

  test("adds check to existing table on postgres", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops).toEqual([{ kind: "createCheck", check: expect.any(Object) }]);
    expect(sql).toContain(
      'ALTER TABLE "posts" ADD CONSTRAINT "posts_age_check" CHECK (age > 21)',
    );
  });

  test("sqlite adds check to existing table via recreateTable", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops).toEqual([
      {
        kind: "recreateTable",
        from: expect.any(Object),
        to: expect.any(Object),
      },
    ]);
    expect(sql).toContain('CONSTRAINT "posts_age_check" CHECK (age > 21)');
    expect(sql).not.toContain('ALTER TABLE "posts" ADD CONSTRAINT');
  });

  test("sqlite drops check from existing table via recreateTable", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("sqlite"),
    );
    const sql = getMigrationDialect("sqlite").render(ops);

    expect(ops[0]?.kind).toBe("recreateTable");
    expect(sql).toContain('CREATE TABLE "posts__semola_tmp"');
    expect(sql).not.toContain('DROP CONSTRAINT "posts_age_check"');
    expect(sql).not.toContain('CONSTRAINT "posts_age_check" CHECK');
  });

  test("drops check from existing table", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops).toEqual([{ kind: "dropCheck", check: expect.any(Object) }]);
    expect(sql).toContain(
      'ALTER TABLE "posts" DROP CONSTRAINT "posts_age_check"',
    );
  });

  test("changing a check drops and recreates it", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 18"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.map((op) => op.kind)).toEqual(["dropCheck", "createCheck"]);
  });

  test("dropCheck precedes dropColumn for referenced column", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: {
        id: postsColumns.id,
        authorId: postsColumns.authorId,
        startedAt: postsColumns.startedAt,
        endedAt: postsColumns.endedAt,
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.map((op) => op.kind)).toEqual(["dropCheck", "dropColumn"]);
  });

  test("identical schemas with checks produce no ops", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts }),
      snapshotSchema({ posts }),
      getMigrationDialect("postgres"),
    );

    expect(ops).toEqual([]);
  });

  test("dropped table does not emit dropCheck because checks are inline", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts }),
      emptySchema(),
      getMigrationDialect("postgres"),
      { strictAddColumn: false },
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops.map((op) => op.kind)).toEqual(["dropTable"]);
    expect(sql).toContain('DROP TABLE "posts"');
    expect(sql).not.toContain("DROP CONSTRAINT");
  });

  test("down migration recreates dropped check on postgres", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const down = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: after }),
        snapshotSchema({ posts: before }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(down).toContain(
      'ALTER TABLE "posts" ADD CONSTRAINT "posts_age_check" CHECK (age > 21)',
    );
  });

  test("drops multiple checks when removing several", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.filter((op) => op.kind === "dropCheck")).toHaveLength(2);
  });

  test("adds multiple checks to existing table on postgres", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops.map((op) => op.kind)).toEqual(["createCheck", "createCheck"]);
    expect(sql).toContain('ADD CONSTRAINT "posts_age_check"');
    expect(sql).toContain('ADD CONSTRAINT "posts_dates_check"');
  });

  test("snapshots multi-column check columns from on()", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_combined_check")
          .on(columns.age, columns.startedAt, columns.endedAt)
          .where("age > 21 AND started_at < ended_at"),
      ],
    });
    const snapshot = snapshotSchema({ posts });

    expect(snapshot.tables.posts?.checks.posts_combined_check?.columns).toEqual(
      ["age", "started_at", "ended_at"],
    );
  });

  test("renders complex check expression in CREATE TABLE", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_complex_check")
          .on(columns.age, columns.startedAt, columns.endedAt)
          .where("age IS NULL OR (age > 21 AND started_at < ended_at)"),
      ],
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        emptySchema(),
        snapshotSchema({ posts }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      'CONSTRAINT "posts_complex_check" CHECK (age IS NULL OR (age > 21 AND started_at < ended_at))',
    );
  });

  test("assertSchemaSnapshot accepts checks field on tables", () => {
    const checkName = "posts_age_check";
    const schema = {
      tables: {
        posts: {
          name: "posts",
          columns: {
            age: {
              name: "age",
              type: "number",
              isNullable: true,
              isPrimaryKey: false,
              isUnique: false,
            },
          },
          indexes: {},
          checks: {
            [checkName]: {
              name: checkName,
              table: "posts",
              expression: "age > 21",
              columns: ["age"],
            },
          },
        },
      },
    } satisfies SchemaSnapshot;

    expect(assertSchemaSnapshot(schema, "schema.json")).toEqual(schema);
  });

  test("assertSchemaSnapshot defaults missing checks to empty object", () => {
    const normalized = assertSchemaSnapshot(
      {
        tables: {
          posts: {
            name: "posts",
            columns: {
              age: {
                name: "age",
                type: "number",
                isNullable: true,
                isPrimaryKey: false,
                isUnique: false,
              },
            },
            indexes: {},
          },
        },
      },
      "schema.json",
    );

    expect(normalized.tables.posts?.checks).toEqual({});
  });

  test("assertSchemaSnapshot rejects invalid check snapshot", () => {
    expect(() =>
      assertSchemaSnapshot(
        {
          tables: {
            posts: {
              name: "posts",
              columns: {},
              indexes: {},
              checks: {
                bad: 1,
              },
            },
          },
        },
        "schema.json",
      ),
    ).toThrow("Invalid schema.json");
  });

  test("changes check on() columns via drop and recreate", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt)
          .where("started_at IS NOT NULL"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at IS NOT NULL"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.map((op) => op.kind)).toEqual(["dropCheck", "createCheck"]);
  });

  test("changing only on() columns keeps expression in recreated check", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt)
          .where("started_at < ended_at"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: before }),
        snapshotSchema({ posts: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql).toContain(
      'ADD CONSTRAINT "posts_dates_check" CHECK (started_at < ended_at)',
    );
  });

  test("changing only expression keeps on() columns in snapshot", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age >= 21"),
      ],
    });
    const snapshot = snapshotSchema({ posts });

    expect(snapshot.tables.posts?.checks.posts_age_check?.columns).toEqual([
      "age",
    ]);
    expect(snapshot.tables.posts?.checks.posts_age_check?.expression).toBe(
      "age >= 21",
    );
  });

  test("dropping column not listed in on() does not drop check", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: {
        id: postsColumns.id,
        authorId: postsColumns.authorId,
        age: postsColumns.age,
        startedAt: postsColumns.startedAt,
      },
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.map((op) => op.kind)).toEqual(["dropColumn"]);
    expect(ops.filter((op) => op.kind === "dropCheck")).toHaveLength(0);
  });

  test("dropping one of several on() columns drops the check first", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: {
        id: postsColumns.id,
        authorId: postsColumns.authorId,
        age: postsColumns.age,
        startedAt: postsColumns.startedAt,
      },
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.map((op) => op.kind)).toEqual(["dropCheck", "dropColumn"]);
  });

  test("new table with checks and indexes emits createTable then createIndex", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const ops = diffSchemas(
      emptySchema(),
      snapshotSchema({ posts }),
      getMigrationDialect("postgres"),
    );
    const sql = getMigrationDialect("postgres").render(ops);

    expect(ops.map((op) => op.kind)).toEqual(["createTable", "createIndex"]);
    expect(sql).toContain('CONSTRAINT "posts_age_check" CHECK (age > 21)');
    expect(sql).toContain('CREATE INDEX "posts_author_idx"');
  });

  test("postgres dropCheck precedes dropIndex in rendered sql", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      indexes: (columns) => [index("posts_age_idx").on(columns.age)],
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: {
        id: postsColumns.id,
        authorId: postsColumns.authorId,
        startedAt: postsColumns.startedAt,
        endedAt: postsColumns.endedAt,
      },
    });
    const sql = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: before }),
        snapshotSchema({ posts: after }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(sql.indexOf('DROP CONSTRAINT "posts_age_check"')).toBeLessThan(
      sql.indexOf('DROP INDEX "posts_age_idx"'),
    );
    expect(sql.indexOf('DROP INDEX "posts_age_idx"')).toBeLessThan(
      sql.indexOf('DROP COLUMN "age"'),
    );
  });

  test("down migration drops added check on postgres", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const down = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: after }),
        snapshotSchema({ posts: before }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(down).toContain(
      'ALTER TABLE "posts" DROP CONSTRAINT "posts_age_check"',
    );
  });

  test("down migration reverses expression change on postgres", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 18"),
      ],
    });
    const down = getMigrationDialect("postgres").render(
      diffSchemas(
        snapshotSchema({ posts: after }),
        snapshotSchema({ posts: before }),
        getMigrationDialect("postgres"),
      ),
    );

    expect(down).toContain('DROP CONSTRAINT "posts_age_check"');
    expect(down).toContain('ADD CONSTRAINT "posts_age_check" CHECK (age > 21)');
  });

  test("down migration reverses on() column change on sqlite", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt)
          .where("started_at IS NOT NULL"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at IS NOT NULL"),
      ],
    });
    const downOps = diffSchemas(
      snapshotSchema({ posts: after }),
      snapshotSchema({ posts: before }),
      getMigrationDialect("sqlite"),
    );
    const down = getMigrationDialect("sqlite").render(downOps);

    expect(downOps[0]?.kind).toBe("recreateTable");
    expect(down).toContain('CREATE TABLE "posts__semola_tmp"');
    expect(down).not.toContain('DROP CONSTRAINT "posts_dates_check"');
    expect(down).toContain(
      'CONSTRAINT "posts_dates_check" CHECK (started_at IS NOT NULL)',
    );
  });

  test("removing one check keeps the other", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops).toEqual([{ kind: "dropCheck", check: expect.any(Object) }]);
  });

  test("replacing one check with another emits drop and create", () => {
    const before = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("age > 21"),
      ],
    });
    const after = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_score_check").on(columns.age).where("age >= 0"),
      ],
    });
    const ops = diffSchemas(
      snapshotSchema({ posts: before }),
      snapshotSchema({ posts: after }),
      getMigrationDialect("postgres"),
    );

    expect(ops.map((op) => op.kind)).toEqual(["dropCheck", "createCheck"]);
  });

  test("snapshot preserves expression whitespace verbatim", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: postsColumns,
      checks: (columns) => [
        check("posts_age_check").on(columns.age).where("  age   >   21  "),
      ],
    });
    const snapshot = snapshotSchema({ posts });

    expect(snapshot.tables.posts?.checks.posts_age_check?.expression).toBe(
      "  age   >   21  ",
    );
  });

  test("assertSchemaSnapshot rejects whitespace-only check expression", () => {
    const checkName = "posts_age_check";

    expect(() =>
      assertSchemaSnapshot(
        {
          tables: {
            posts: {
              name: "posts",
              columns: {
                age: {
                  name: "age",
                  type: "number",
                  isNullable: true,
                  isPrimaryKey: false,
                  isUnique: false,
                },
              },
              indexes: {},
              checks: {
                [checkName]: {
                  name: checkName,
                  table: "posts",
                  expression: "   ",
                  columns: ["age"],
                },
              },
            },
          },
        },
        "schema.json",
      ),
    ).toThrow("has invalid expression");
  });

  test("assertSchemaSnapshot rejects check with empty columns array", () => {
    expect(() =>
      assertSchemaSnapshot(
        {
          tables: {
            posts: {
              name: "posts",
              columns: {},
              indexes: {},
              checks: {
                bad: {
                  name: "bad",
                  table: "posts",
                  expression: "age > 21",
                  columns: [],
                },
              },
            },
          },
        },
        "schema.json",
      ),
    ).toThrow("Invalid schema.json");
  });
});

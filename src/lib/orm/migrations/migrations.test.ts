import { describe, expect, test } from "bun:test";
import { enumType, number, string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { diffSchemas, invertOps } from "./diff.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import { decodeSchemaHeader, renderMigrationSql } from "./sql.js";

describe("orm migrations snapshot/diff/sql", () => {
  test("snapshots tables and columns", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique().dbDefault("'x'"),
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

    const down = renderMigrationSql("sqlite", invertOps(ops));

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

  test("sqlite recreates table on column type change and copies rows", () => {
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

  test("decodeSchemaHeader rejects invalid json", () => {
    expect(() => decodeSchemaHeader("-- semola-schema:{nope")).toThrow(
      "Invalid schema header",
    );
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

  test("throws for a bare dbDefault string", () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      role: string("role").notNull().dbDefault("anon"),
    });

    expect(() =>
      renderMigrationSql(
        "sqlite",
        diffSchemas(emptySchema(), snapshotSchema({ users }), "sqlite"),
      ),
    ).toThrow("dbDefault must be SQL");
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

  test("throws for unsupported adapters", () => {
    const adapter = "mysql";

    expect(() =>
      // @ts-expect-error - testing runtime guard for values outside the Adapter type
      renderMigrationSql(adapter, []),
    ).toThrow("Unsupported adapter: mysql");
  });
});

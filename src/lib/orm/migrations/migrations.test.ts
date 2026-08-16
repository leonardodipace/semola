import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { diffSchemas, invertOps } from "./diff.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import { renderMigrationSql } from "./sql.js";

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
    expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
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

    expect(sql).toContain('"id" UUID PRIMARY KEY NOT NULL');
  });

  test("diffs add column", () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });

    const ops = diffSchemas(
      snapshotSchema({ users: before }),
      snapshotSchema({ users: after }),
      "sqlite",
    );

    expect(ops).toEqual([
      {
        kind: "addColumn",
        table: "users",
        column: expect.objectContaining({ name: "name" }),
      },
    ]);
  });

  test("sqlite recreates table on column type change", () => {
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

    expect(ops[0]?.kind).toBe("recreateTable");
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
});

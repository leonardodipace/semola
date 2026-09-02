import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { many, one } from "../orm/relations.js";
import { defineTable } from "../table/index.js";
import {
  parseRelationWrite,
  planHasOneRelationWrites,
  splitMutationData,
} from "./mutation-relations.js";
import { SQLITE_SPEC } from "./sqlite.js";

const usersTable = defineTable({
  sqlName: "users",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    email: string("email").notNull().unique(),
  },
});

const postsTable = defineTable({
  sqlName: "posts",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    title: string("title").notNull(),
    authorId: uuid("author_id")
      .nullable()
      .references(() => usersTable.columns.id),
  },
});

describe("mutation-relations", () => {
  test("splitMutationData separates columns and relation writes", () => {
    const result = splitMutationData(
      usersTable,
      { posts: many(() => postsTable) },
      {
        id: "u1",
        email: "ada@example.com",
        posts: { connect: [{ id: "p1" }] },
      },
    );

    expect(result.columnData).toEqual({
      id: "u1",
      email: "ada@example.com",
    });
    expect(result.relationWrites).toEqual([
      {
        relationName: "posts",
        connect: [{ id: "p1" }],
      },
    ]);
  });

  test("parseRelationWrite rejects connect and disconnect together", () => {
    expect(() =>
      parseRelationWrite("posts", {
        connect: { id: "p1" },
        disconnect: true,
      }),
    ).toThrow("cannot include both connect and disconnect");
  });

  test("planHasOneRelationWrites resolves connect by unique field", async () => {
    const sql = new Bun.SQL(":memory:", { adapter: "sqlite" });

    await sql.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE)",
    );
    await sql.unsafe(
      "CREATE TABLE posts (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, author_id TEXT)",
    );
    await sql.unsafe(
      "INSERT INTO users (id, email) VALUES ('u1', 'ada@example.com')",
    );

    const columnData = await planHasOneRelationWrites({
      sql,
      spec: SQLITE_SPEC,
      parentTable: postsTable,
      relations: { author: one("authorId", () => usersTable) },
      relationWrites: [
        parseRelationWrite("author", { connect: { email: "ada@example.com" } }),
      ],
    });

    expect(columnData).toEqual({ authorId: "u1" });

    await sql.close();
  });

  test("planHasOneRelationWrites throws when connect target is missing", async () => {
    const sql = new Bun.SQL(":memory:", { adapter: "sqlite" });

    await sql.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE)",
    );
    await sql.unsafe(
      "CREATE TABLE posts (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, author_id TEXT)",
    );

    await expect(
      planHasOneRelationWrites({
        sql,
        spec: SQLITE_SPEC,
        parentTable: postsTable,
        relations: { author: one("authorId", () => usersTable) },
        relationWrites: [
          parseRelationWrite("author", { connect: { id: "missing" } }),
        ],
      }),
    ).rejects.toThrow("Record to connect not found");

    await sql.close();
  });
});

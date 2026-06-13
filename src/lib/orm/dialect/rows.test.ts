import { describe, expect, test } from "bun:test";
import { boolean, json, jsonb, string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { parseIncludeRows } from "./rows.js";
import type { IncludeDescriptor } from "./types.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  firstName: string("first_name").notNull(),
  isActive: boolean("is_active").notNull(),
});

const postsTable = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => usersTable.columns.id),
});

const eventsTable = defineTable("events", {
  id: uuid("id").primaryKey().notNull(),
  payload: json("payload").notNull(),
  meta: jsonb("meta").notNull(),
  published: boolean("published").notNull(),
});

describe("rows", () => {
  test("coerces root boolean and JSON column values", () => {
    const rows: Array<Record<string, unknown>> = [
      {
        id: "e-1",
        payload: '{"items":[1,2]}',
        meta: '{"source":"test"}',
        published: 1,
      },
    ];

    parseIncludeRows({ table: eventsTable, rows, descriptors: [] });

    expect(rows).toEqual([
      {
        id: "e-1",
        payload: { items: [1, 2] },
        meta: { source: "test" },
        published: true,
      },
    ]);
  });

  test("parses JSON include values and normalizes null hasMany values", () => {
    const descriptors = [
      { name: "posts", type: "hasMany", table: postsTable },
      { name: "author", type: "hasOne", table: usersTable },
    ] satisfies Array<IncludeDescriptor>;
    const rows: Array<Record<string, unknown>> = [
      { id: "u-1", posts: null, author: null },
      {
        id: "u-2",
        posts: '[{"id":"p-1","title":"Hello","authorId":"u-2"}]',
        author: '{"id":"u-1","firstName":"Ada","isActive":1}',
      },
    ];

    parseIncludeRows({ table: usersTable, rows, descriptors });

    expect(rows).toEqual([
      { id: "u-1", posts: [], author: null },
      {
        id: "u-2",
        posts: [{ id: "p-1", title: "Hello", authorId: "u-2" }],
        author: { id: "u-1", firstName: "Ada", isActive: true },
      },
    ]);
  });

  test("coerces boolean values in nested relation objects", () => {
    const descriptors = [
      {
        name: "posts",
        type: "hasMany",
        table: postsTable,
        nested: [
          { name: "author", type: "hasOne", table: usersTable, nested: [] },
        ],
      },
    ] satisfies Array<IncludeDescriptor>;
    const rows: Array<Record<string, unknown>> = [
      {
        id: "u-1",
        posts:
          '[{"id":"p-1","title":"Hello","authorId":"u-1","author":{"id":"u-1","firstName":"Ada","isActive":0}}]',
      },
    ];

    parseIncludeRows({ table: usersTable, rows, descriptors });

    const posts = rows[0]?.posts as Array<Record<string, unknown>>;
    const author = posts[0]?.author as Record<string, unknown>;

    expect(author?.isActive).toBe(false);
  });
});

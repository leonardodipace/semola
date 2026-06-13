import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import { createNextPlaceholder } from "./clauses.js";
import { buildIncludeClause } from "./relations.js";
import { SQLITE_SPEC } from "./sqlite.js";
import { postsTable, usersTable } from "./test-fixtures.js";

describe("relations", () => {
  test("builds hasMany include SQL and descriptors", () => {
    const include = buildIncludeClause({
      spec: SQLITE_SPEC,
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      parentAlias: '"users"',
      relations: { posts: many(() => postsTable) },
      tableRelationsMap: new Map(),
      include: { posts: true },
    });

    expect(include.sql).toBe(
      'COALESCE((SELECT json_group_array(json_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id"), \'[]\') AS "posts"',
    );
    expect(include.params).toEqual([]);
    expect(include.descriptors).toEqual([
      expect.objectContaining({ name: "posts", type: "hasMany" }),
    ]);
  });

  test("builds hasOne include SQL", () => {
    const include = buildIncludeClause({
      spec: SQLITE_SPEC,
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: postsTable,
      parentAlias: '"posts"',
      relations: { author: one("authorId", () => usersTable) },
      tableRelationsMap: new Map(),
      include: { author: true },
    });

    expect(include.sql).toBe(
      '(SELECT json_object(\'id\', author__users."id", \'firstName\', author__users."first_name", \'createdAt\', author__users."created_at", \'isActive\', author__users."is_active") FROM "users" AS author__users WHERE author__users."id" = "posts"."author_id" LIMIT 1) AS "author"',
    );
    expect(include.params).toEqual([]);
  });

  test("builds nested include params before relation where params", () => {
    const postsRelations = { author: one("authorId", () => usersTable) };
    const include = buildIncludeClause({
      spec: SQLITE_SPEC,
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      parentAlias: '"users"',
      relations: { posts: many(() => postsTable) },
      tableRelationsMap: new Map([[postsTable, postsRelations]]),
      include: {
        posts: {
          where: { title: "Hello" },
          include: { author: { where: { firstName: "Ada" } } },
          take: 2,
        },
      },
    });

    expect(include.sql).toContain("'author'");
    expect(include.sql).toContain("LIMIT ?");
    expect(include.params).toEqual(["Ada", "Hello", 2]);
    expect(include.descriptors[0]?.nested?.[0]).toEqual(
      expect.objectContaining({ name: "author", type: "hasOne" }),
    );
  });

  test("ignores disabled include flags", () => {
    const include = buildIncludeClause({
      spec: SQLITE_SPEC,
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      parentAlias: '"users"',
      relations: { posts: many(() => postsTable) },
      tableRelationsMap: new Map(),
      include: { posts: false },
    });

    expect(include).toEqual({ sql: "", params: [], descriptors: [] });
  });

  test("throws for unknown relation names", () => {
    expect(() =>
      buildIncludeClause({
        spec: SQLITE_SPEC,
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        parentAlias: '"users"',
        relations: {},
        tableRelationsMap: new Map(),
        include: { posts: true },
      }),
    ).toThrow("Unknown relation posts on table users");
  });

  test("throws for unknown nested relation names", () => {
    expect(() =>
      buildIncludeClause({
        spec: SQLITE_SPEC,
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        parentAlias: '"users"',
        relations: { posts: many(() => postsTable) },
        tableRelationsMap: new Map([[postsTable, {}]]),
        include: { posts: { include: { author: true } } },
      }),
    ).toThrow("Unknown relation author on table posts");
  });

  test("throws for unknown nested select keys", () => {
    expect(() =>
      buildIncludeClause({
        spec: SQLITE_SPEC,
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        parentAlias: '"users"',
        relations: { posts: many(() => postsTable) },
        tableRelationsMap: new Map(),
        include: {
          posts: {
            select: {
              // @ts-expect-error runtime guard for invalid nested select key
              missing: true,
            },
          },
        },
      }),
    ).toThrow('Unknown select key "missing" on table posts');
  });

  test("throws for missing or ambiguous hasMany foreign keys", () => {
    const commentsTable = defineTable("comments", {
      id: uuid("id").primaryKey().notNull(),
      body: string("body").notNull(),
    });
    const membershipsTable = defineTable("memberships", {
      id: uuid("id").primaryKey().notNull(),
      memberId: uuid("member_id").references(() => usersTable.columns.id),
      ownerId: uuid("owner_id").references(() => usersTable.columns.id),
    });

    expect(() =>
      buildIncludeClause({
        spec: SQLITE_SPEC,
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        parentAlias: '"users"',
        relations: { comments: many(() => commentsTable) },
        tableRelationsMap: new Map(),
        include: { comments: true },
      }),
    ).toThrow("Missing hasMany foreign key from comments to users");

    expect(() =>
      buildIncludeClause({
        spec: SQLITE_SPEC,
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        parentAlias: '"users"',
        relations: { memberships: many(() => membershipsTable) },
        tableRelationsMap: new Map(),
        include: { memberships: true },
      }),
    ).toThrow("Ambiguous hasMany foreign key from memberships to users");
  });

  test("throws for invalid hasOne foreign keys", () => {
    const profilesTable = defineTable("profiles", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio").notNull(),
    });

    expect(() =>
      buildIncludeClause({
        spec: SQLITE_SPEC,
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        parentAlias: '"users"',
        relations: { profile: one("profileId", () => profilesTable) },
        tableRelationsMap: new Map(),
        include: { profile: true },
      }),
    ).toThrow("Missing hasOne foreign key column profileId on users");

    expect(() =>
      buildIncludeClause({
        spec: SQLITE_SPEC,
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        parentAlias: '"users"',
        relations: { profile: one("firstName", () => profilesTable) },
        tableRelationsMap: new Map(),
        include: { profile: true },
      }),
    ).toThrow("Column firstName on users is not a foreign key");
  });
});

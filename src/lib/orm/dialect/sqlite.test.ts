import { describe, expect, test } from "bun:test";
import { date, string, uuid } from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import {
  buildSqliteFindManyQuery,
  parseSqliteIncludeRows,
  type SqliteIncludeDescriptor,
} from "./sqlite.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  firstName: string("first_name").notNull(),
  createdAt: date("created_at").notNull(),
});

const postsTable = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => usersTable.columns.id),
});

describe("buildSqliteFindManyQuery", () => {
  test("builds a select statement with where operators, ordering, and pagination", () => {
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");

    const query = buildSqliteFindManyQuery(
      usersTable,
      { posts: many(() => postsTable) },
      {
        select: { id: true, firstName: true },
        where: {
          firstName: { startsWith: "Jo" },
          createdAt: { gte: createdAfter },
        },
        orderBy: { createdAt: "desc", firstName: "asc" },
        take: 10,
        skip: 5,
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName FROM users WHERE first_name LIKE ? AND created_at >= ? ORDER BY created_at DESC, first_name ASC LIMIT ? OFFSET ?",
    );
    expect(query.params).toEqual(["Jo%", createdAfter.toISOString(), 10, 5]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds offset-only pagination with LIMIT -1 OFFSET", () => {
    const query = buildSqliteFindManyQuery(usersTable, {}, { skip: 3 });

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users LIMIT -1 OFFSET ?",
    );
    expect(query.params).toEqual([3]);
  });

  test("builds hasMany include subquery SQL", () => {
    const query = buildSqliteFindManyQuery(
      usersTable,
      { posts: many(() => postsTable) },
      {
        include: { posts: true },
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt, COALESCE((SELECT json_group_array(json_object('id', posts__posts.id, 'title', posts__posts.title, 'authorId', posts__posts.author_id)) FROM posts AS posts__posts WHERE posts__posts.author_id = users.id), '[]') AS posts FROM users",
    );
    expect(query.params).toEqual([]);
    expect(query.includeDescriptors).toEqual([
      { name: "posts", type: "hasMany" },
    ]);
  });

  test("builds hasOne include subquery SQL", () => {
    const query = buildSqliteFindManyQuery(
      postsTable,
      { author: one(() => usersTable) },
      {
        include: { author: true },
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, title AS title, author_id AS authorId, (SELECT json_object('id', author__users.id, 'firstName', author__users.first_name, 'createdAt', author__users.created_at) FROM users AS author__users WHERE author__users.id = posts.author_id LIMIT 1) AS author FROM posts",
    );
    expect(query.params).toEqual([]);
    expect(query.includeDescriptors).toEqual([
      { name: "author", type: "hasOne" },
    ]);
  });

  test("throws for unknown relation names", () => {
    expect(() =>
      buildSqliteFindManyQuery(
        usersTable,
        {},
        {
          include: { posts: true },
        },
      ),
    ).toThrow("Unknown relation posts on table users");
  });

  test("throws when hasMany relation foreign key is missing", () => {
    const commentsTable = defineTable("comments", {
      id: uuid("id").primaryKey().notNull(),
      body: string("body").notNull(),
    });

    expect(() =>
      buildSqliteFindManyQuery(
        usersTable,
        { comments: many(() => commentsTable) },
        {
          include: { comments: true },
        },
      ),
    ).toThrow("Missing hasMany foreign key from comments to users");
  });

  test("throws when hasMany relation foreign key is ambiguous", () => {
    const membershipsTable = defineTable("memberships", {
      id: uuid("id").primaryKey().notNull(),
      memberId: uuid("member_id").references(() => usersTable.columns.id),
      ownerId: uuid("owner_id").references(() => usersTable.columns.id),
    });

    expect(() =>
      buildSqliteFindManyQuery(
        usersTable,
        { memberships: many(() => membershipsTable) },
        {
          include: { memberships: true },
        },
      ),
    ).toThrow("Ambiguous hasMany foreign key from memberships to users");
  });

  test("throws when hasOne local foreign key column is missing", () => {
    const profilesTable = defineTable("profiles", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio").notNull(),
    });

    expect(() =>
      buildSqliteFindManyQuery(
        usersTable,
        { profile: one(() => profilesTable) },
        {
          include: { profile: true },
        },
      ),
    ).toThrow("Missing hasOne foreign key column profileId on users");
  });
});

describe("parseSqliteIncludeRows", () => {
  test("parses JSON include values and normalizes null hasMany values", () => {
    const descriptors = [
      { name: "posts", type: "hasMany" },
      { name: "author", type: "hasOne" },
    ] satisfies Array<SqliteIncludeDescriptor>;

    const rows = [
      { id: "u1", posts: null, author: null },
      {
        id: "u2",
        posts: '[{"id":"p1","title":"Hello"}]',
        author: '{"id":"u1","firstName":"John"}',
      },
    ];

    const parsed = parseSqliteIncludeRows(rows, descriptors);

    expect(parsed).toEqual([
      { id: "u1", posts: [], author: null },
      {
        id: "u2",
        posts: [{ id: "p1", title: "Hello" }],
        author: { id: "u1", firstName: "John" },
      },
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { date, string, uuid } from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import {
  buildFindManyQuery,
  buildFindUniqueQuery,
  createSqliteDialect,
  type IncludeDescriptor,
  parseIncludeRows,
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

const CREATE_USERS_TABLE_SQL =
  "CREATE TABLE users (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, created_at TEXT NOT NULL)";

const CREATE_POSTS_TABLE_SQL =
  "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, author_id TEXT NOT NULL)";

const createMemorySql = () => {
  return new Bun.SQL(":memory:");
};

const createUsersTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_USERS_TABLE_SQL);
};

const createPostsTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_POSTS_TABLE_SQL);
};

const insertUser = async (
  sql: Bun.SQL,
  id: string,
  firstName: string,
  createdAt: string,
) => {
  await sql.unsafe(
    "INSERT INTO users (id, first_name, created_at) VALUES (?, ?, ?)",
    [id, firstName, createdAt],
  );
};

const insertPost = async (
  sql: Bun.SQL,
  id: string,
  title: string,
  authorId: string,
) => {
  await sql.unsafe(
    "INSERT INTO posts (id, title, author_id) VALUES (?, ?, ?)",
    [id, title, authorId],
  );
};

describe("buildFindManyQuery", () => {
  test("builds a select statement with where operators, ordering, and pagination", () => {
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");

    const query = buildFindManyQuery(
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
    const query = buildFindManyQuery(usersTable, {}, { skip: 3 });

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users LIMIT -1 OFFSET ?",
    );
    expect(query.params).toEqual([3]);
  });

  test("builds hasMany include subquery SQL", () => {
    const query = buildFindManyQuery(
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
    const query = buildFindManyQuery(
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

  test("ignores disabled include flags and supports take-only pagination", () => {
    const query = buildFindManyQuery(
      usersTable,
      { posts: many(() => postsTable) },
      {
        include: {
          posts: false,
        },
        take: 2,
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users LIMIT ?",
    );
    expect(query.params).toEqual([2]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("throws for unknown relation names", () => {
    expect(() =>
      buildFindManyQuery(
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
      buildFindManyQuery(
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
      buildFindManyQuery(
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
      buildFindManyQuery(
        usersTable,
        { profile: one(() => profilesTable) },
        {
          include: { profile: true },
        },
      ),
    ).toThrow("Missing hasOne foreign key column profileId on users");
  });
});

describe("buildFindUniqueQuery", () => {
  test("builds a select statement with LIMIT 1", () => {
    const query = buildFindUniqueQuery(
      usersTable,
      {},
      {
        where: {
          id: "user-1",
        },
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users WHERE id = ? LIMIT 1",
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("throws when runtime where payload has multiple keys", () => {
    expect(() =>
      buildFindUniqueQuery(
        usersTable,
        {},
        {
          where: {
            id: "user-1",
            // @ts-expect-error
            firstName: "John",
          },
        },
      ),
    ).toThrow("findUnique requires exactly one where key");
  });

  test("throws when runtime where payload is empty", () => {
    expect(() =>
      buildFindUniqueQuery(
        usersTable,
        {},
        {
          // @ts-expect-error
          where: {},
        },
      ),
    ).toThrow("findUnique requires exactly one where key");
  });

  test("throws when runtime where payload has an unknown key", () => {
    expect(() =>
      buildFindUniqueQuery(
        usersTable,
        {},
        {
          where: {
            // @ts-expect-error
            nickname: "john",
          },
        },
      ),
    ).toThrow("Unknown where key nickname on table users");
  });

  test("throws when runtime where payload points to a non-unique column", () => {
    expect(() =>
      buildFindUniqueQuery(
        usersTable,
        {},
        {
          where: {
            // @ts-expect-error
            firstName: "John",
          },
        },
      ),
    ).toThrow(
      "findUnique where key firstName must reference a unique or primary key column",
    );
  });

  test("throws when include needs a source primary key that is missing", () => {
    const accountsTable = defineTable("accounts", {
      id: uuid("id").notNull(),
      name: string("name").notNull(),
    });

    const sessionsTable = defineTable("sessions", {
      id: uuid("id").primaryKey().notNull(),
      accountId: uuid("account_id")
        .notNull()
        .references(() => accountsTable.columns.id),
    });

    expect(() =>
      buildFindManyQuery(
        accountsTable,
        { sessions: many(() => sessionsTable) },
        {
          include: {
            sessions: true,
          },
        },
      ),
    ).toThrow("Missing primary key on table accounts");
  });
});

describe("parseIncludeRows", () => {
  test("parses JSON include values and normalizes null hasMany values", () => {
    const descriptors = [
      { name: "posts", type: "hasMany" },
      { name: "author", type: "hasOne" },
    ] satisfies Array<IncludeDescriptor>;

    const rows = [
      { id: "u1", posts: null, author: null },
      {
        id: "u2",
        posts: '[{"id":"p1","title":"Hello"}]',
        author: '{"id":"u1","firstName":"John"}',
      },
    ];

    const parsed = parseIncludeRows(rows, descriptors);

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

describe("createSqliteDialect", () => {
  test("findMany returns raw rows when include is not requested", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});
    const rows = await dialect.findMany(sql, {
      where: {
        id: "user-1",
      },
    });

    expect(rows).toHaveLength(1);

    const [row] = rows;

    expect(row?.id).toBe("user-1");
    expect(row?.firstName).toBe("John");
    expect(new Date(row?.createdAt ?? 0).toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    );

    await sql.close();
  });

  test("findUnique returns null when row is missing without include", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});
    const row = await dialect.findUnique(sql, {
      where: {
        id: "missing",
      },
    });

    expect(row).toBeNull();

    await sql.close();
  });

  test("findUnique parses include rows and returns null when missing", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertPost(sql, "post-1", "Hello", "user-1");

    const dialect = createSqliteDialect(usersTable, {
      posts: many(() => postsTable),
    });

    const existing = await dialect.findUnique(sql, {
      where: {
        id: "user-1",
      },
      include: {
        posts: true,
      },
    });

    const missing = await dialect.findUnique(sql, {
      where: {
        id: "missing",
      },
      include: {
        posts: true,
      },
    });

    expect(existing?.id).toBe("user-1");
    expect(existing?.firstName).toBe("John");
    expect(new Date(existing?.createdAt ?? 0).toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    expect(existing?.posts).toEqual([
      {
        id: "post-1",
        title: "Hello",
        authorId: "user-1",
      },
    ]);

    expect(missing).toBeNull();

    await sql.close();
  });
});

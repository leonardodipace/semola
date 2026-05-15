import { describe, expect, test } from "bun:test";
import { date, string, uuid } from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import {
  buildDeleteQuery,
  buildFindFirstQuery,
  buildFindManyQuery,
  buildFindUniqueQuery,
  buildUpdateQuery,
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
      "SELECT id AS id, first_name AS firstName FROM users WHERE first_name LIKE ? ESCAPE '\\' AND created_at >= ? ORDER BY created_at DESC, first_name ASC LIMIT ? OFFSET ?",
    );
    expect(query.params).toEqual(["Jo%", createdAfter.toISOString(), 10, 5]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("escapes LIKE metacharacters for startsWith, endsWith, and contains", () => {
    const query = buildFindManyQuery(
      usersTable,
      {},
      {
        where: {
          firstName: {
            startsWith: "a%_\\",
            endsWith: "a%_\\",
            contains: "a%_\\",
          },
        },
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users WHERE first_name LIKE ? ESCAPE '\\' AND first_name LIKE ? ESCAPE '\\' AND first_name LIKE ? ESCAPE '\\'",
    );
    expect(query.params).toEqual([
      "a\\%\\_\\\\%",
      "%a\\%\\_\\\\",
      "%a\\%\\_\\\\%",
    ]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("treats non-plain where values as direct equality", () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    const idList = ["user-1"];

    const query = buildFindManyQuery(
      usersTable,
      {},
      {
        where: {
          // @ts-expect-error runtime guard for non-plain object inputs
          id: idList,
          // @ts-expect-error runtime guard for direct date inputs
          createdAt,
          // @ts-expect-error runtime guard for null inputs
          firstName: null,
        },
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users WHERE id = ? AND created_at = ? AND first_name = ?",
    );
    expect(query.params).toEqual([idList, createdAt.toISOString(), null]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds offset-only pagination with LIMIT -1 OFFSET", () => {
    const query = buildFindManyQuery(usersTable, {}, { skip: 3 });

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users LIMIT -1 OFFSET ?",
    );
    expect(query.params).toEqual([3]);
  });

  test("falls back to full column list when select is an empty object", () => {
    const query = buildFindManyQuery(usersTable, {}, { select: {} });

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users",
    );
    expect(query.params).toEqual([]);
    expect(query.includeDescriptors).toEqual([]);
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

  test("allows non-unique guard fields alongside a unique key", () => {
    const query = buildFindUniqueQuery(
      usersTable,
      {},
      {
        where: {
          id: "user-1",
          firstName: "John",
        },
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users WHERE id = ? AND first_name = ? LIMIT 1",
    );
    expect(query.params).toEqual(["user-1", "John"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("throws when runtime where payload is empty", () => {
    expect(() =>
      buildFindUniqueQuery(
        usersTable,
        {},
        {
          // @ts-expect-error empty object is not assignable to FindUniqueWhere
          where: {},
        },
      ),
    ).toThrow("findUnique requires at least one where key");
  });

  test("throws when runtime where payload has an unknown key", () => {
    expect(() =>
      buildFindUniqueQuery(
        usersTable,
        {},
        {
          where: {
            // @ts-expect-error nickname is not a column on usersTable
            nickname: "john",
          },
        },
      ),
    ).toThrow("Unknown where key nickname on table users");
  });

  test("throws when runtime where payload has no unique or primary key column", () => {
    expect(() =>
      buildFindUniqueQuery(
        usersTable,
        {},
        {
          // @ts-expect-error firstName alone does not satisfy FindUniqueWhere (no unique key)
          where: {
            firstName: "John",
          },
        },
      ),
    ).toThrow(
      "findUnique where must include at least one unique or primary key column",
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

describe("buildFindFirstQuery", () => {
  test("builds a select statement with LIMIT 1", () => {
    const query = buildFindFirstQuery(
      usersTable,
      {},
      {
        where: {
          firstName: { startsWith: "Jo" },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt FROM users WHERE first_name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?",
    );
    expect(query.params).toEqual(["Jo%", 1]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("supports include and skip while limiting to one row", () => {
    const query = buildFindFirstQuery(
      usersTable,
      { posts: many(() => postsTable) },
      {
        include: {
          posts: true,
        },
        skip: 2,
      },
    );

    expect(query.statement).toBe(
      "SELECT id AS id, first_name AS firstName, created_at AS createdAt, COALESCE((SELECT json_group_array(json_object('id', posts__posts.id, 'title', posts__posts.title, 'authorId', posts__posts.author_id)) FROM posts AS posts__posts WHERE posts__posts.author_id = users.id), '[]') AS posts FROM users LIMIT ? OFFSET ?",
    );
    expect(query.params).toEqual([1, 2]);
    expect(query.includeDescriptors).toEqual([
      { name: "posts", type: "hasMany" },
    ]);
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

  test("findFirst returns the first row or null without include", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const firstByDate = await dialect.findFirst(sql, {
      orderBy: {
        createdAt: "asc",
      },
    });

    const missing = await dialect.findFirst(sql, {
      where: {
        id: "missing",
      },
    });

    expect(firstByDate?.id).toBe("user-1");
    expect(missing).toBeNull();

    await sql.close();
  });

  test("findFirst parses include rows", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");
    await insertPost(sql, "post-1", "Hello", "user-1");

    const dialect = createSqliteDialect(usersTable, {
      posts: many(() => postsTable),
    });

    const first = await dialect.findFirst(sql, {
      orderBy: {
        createdAt: "asc",
      },
      include: {
        posts: true,
      },
    });

    expect(first?.id).toBe("user-1");
    expect(first?.firstName).toBe("John");
    expect(new Date(first?.createdAt ?? 0).toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    expect(first?.posts).toEqual([
      {
        id: "post-1",
        title: "Hello",
        authorId: "user-1",
      },
    ]);

    await sql.close();
  });
});

describe("buildUpdateQuery", () => {
  test("builds an update statement with where clause", () => {
    const query = buildUpdateQuery(
      usersTable,
      {},
      {
        where: { id: "user-1" },
        data: { firstName: "Jane" },
      },
    );

    expect(query.statement).toBe(
      "UPDATE users SET first_name = ? WHERE id = ? RETURNING id AS id, first_name AS firstName, created_at AS createdAt",
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds an update statement with multiple set fields", () => {
    const query = buildUpdateQuery(
      usersTable,
      {},
      {
        where: { id: "user-1" },
        data: {
          firstName: "Jane",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    );

    expect(query.statement).toBe(
      "UPDATE users SET first_name = ?, created_at = ? WHERE id = ? RETURNING id AS id, first_name AS firstName, created_at AS createdAt",
    );
    expect(query.params).toEqual([
      "Jane",
      "2026-01-01T00:00:00.000Z",
      "user-1",
    ]);
  });

  test("builds an update statement with select columns in RETURNING", () => {
    const query = buildUpdateQuery(
      usersTable,
      {},
      {
        where: { id: "user-1" },
        data: { firstName: "Jane" },
        select: { id: true, firstName: true },
      },
    );

    expect(query.statement).toBe(
      "UPDATE users SET first_name = ? WHERE id = ? RETURNING id AS id, first_name AS firstName",
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("throws when where is empty", () => {
    expect(() =>
      buildUpdateQuery(
        usersTable,
        {},
        {
          // @ts-expect-error empty object is not assignable to FindUniqueWhere
          where: {},
          data: { firstName: "Jane" },
        },
      ),
    ).toThrow("findUnique requires at least one where key");
  });

  test("skips unknown data keys", () => {
    const query = buildUpdateQuery(
      usersTable,
      {},
      {
        where: { id: "user-1" },
        // @ts-expect-error nonExistent is not a column on usersTable
        data: { firstName: "Jane", nonExistent: "value" },
      },
    );

    expect(query.statement).toBe(
      "UPDATE users SET first_name = ? WHERE id = ? RETURNING id AS id, first_name AS firstName, created_at AS createdAt",
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
  });

  test("throws when data is empty", () => {
    expect(() =>
      buildUpdateQuery(
        usersTable,
        {},
        {
          where: { id: "user-1" },
          data: {},
        },
      ),
    ).toThrow("update requires at least one field in data");
  });

  test("serializes Date values in data", () => {
    const date = new Date("2026-06-01T00:00:00.000Z");

    const query = buildUpdateQuery(
      usersTable,
      {},
      {
        where: { id: "user-1" },
        data: { createdAt: date },
      },
    );

    expect(query.statement).toBe(
      "UPDATE users SET created_at = ? WHERE id = ? RETURNING id AS id, first_name AS firstName, created_at AS createdAt",
    );
    expect(query.params).toEqual(["2026-06-01T00:00:00.000Z", "user-1"]);
  });

  test("builds an update statement with hasMany include in RETURNING", () => {
    const query = buildUpdateQuery(
      usersTable,
      { posts: many(() => postsTable) },
      {
        where: { id: "user-1" },
        data: { firstName: "Jane" },
        include: { posts: true },
      },
    );

    expect(query.statement).toBe(
      "UPDATE users SET first_name = ? WHERE id = ? RETURNING id AS id, first_name AS firstName, created_at AS createdAt, COALESCE((SELECT json_group_array(json_object('id', posts__posts.id, 'title', posts__posts.title, 'authorId', posts__posts.author_id)) FROM posts AS posts__posts WHERE posts__posts.author_id = users.id), '[]') AS posts",
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
    expect(query.includeDescriptors).toEqual([
      { name: "posts", type: "hasMany" },
    ]);
  });

  test("builds an update statement with hasOne include in RETURNING", () => {
    const query = buildUpdateQuery(
      postsTable,
      { author: one(() => usersTable) },
      {
        where: { id: "post-1" },
        data: { title: "Updated" },
        include: { author: true },
      },
    );

    expect(query.statement).toBe(
      "UPDATE posts SET title = ? WHERE id = ? RETURNING id AS id, title AS title, author_id AS authorId, (SELECT json_object('id', author__users.id, 'firstName', author__users.first_name, 'createdAt', author__users.created_at) FROM users AS author__users WHERE author__users.id = posts.author_id LIMIT 1) AS author",
    );
    expect(query.params).toEqual(["Updated", "post-1"]);
    expect(query.includeDescriptors).toEqual([
      { name: "author", type: "hasOne" },
    ]);
  });
});

describe("createSqliteDialect - update", () => {
  test("updates a row and persists the change", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const updated = await dialect.update(sql, {
      where: { id: "user-1" },
      data: { firstName: "Jane" },
    });

    expect(updated.id).toBe("user-1");
    expect(updated.firstName).toBe("Jane");

    await sql.close();
  });

  test("updates only rows matching where clause", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const updated = await dialect.update(sql, {
      where: { id: "user-1" },
      data: { firstName: "Updated" },
    });

    const untouched = await dialect.findUnique(sql, {
      where: { id: "user-2" },
    });

    expect(updated.firstName).toBe("Updated");
    expect(untouched?.firstName).toBe("Alice");

    await sql.close();
  });

  test("throws when where clause matches no rows", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    await expect(
      dialect.update(sql, {
        where: { id: "missing" },
        data: { firstName: "Ghost" },
      }),
    ).rejects.toThrow("Record not found after update on table users");

    await sql.close();
  });

  test("returns only selected fields", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const updated = await dialect.update(sql, {
      where: { id: "user-1" },
      data: { firstName: "Jane" },
      select: { id: true, firstName: true },
    });

    expect(updated).toEqual({ id: "user-1", firstName: "Jane" });

    await sql.close();
  });

  test("returns include relations on the updated record", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertPost(sql, "post-1", "Hello", "user-1");

    const dialect = createSqliteDialect(usersTable, {
      posts: many(() => postsTable),
    });

    const updated = await dialect.update(sql, {
      where: { id: "user-1" },
      data: { firstName: "Jane" },
      include: { posts: true },
    });

    expect(updated.firstName).toBe("Jane");
    expect(updated.posts).toEqual([
      { id: "post-1", title: "Hello", authorId: "user-1" },
    ]);

    await sql.close();
  });
});

describe("buildDeleteQuery", () => {
  test("builds a delete statement with where clause", () => {
    const query = buildDeleteQuery(usersTable, {}, { where: { id: "user-1" } });

    expect(query.statement).toBe(
      "DELETE FROM users WHERE id = ? RETURNING id AS id, first_name AS firstName, created_at AS createdAt",
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds a delete statement with select columns in RETURNING", () => {
    const query = buildDeleteQuery(
      usersTable,
      {},
      {
        where: { id: "user-1" },
        select: { id: true, firstName: true },
      },
    );

    expect(query.statement).toBe(
      "DELETE FROM users WHERE id = ? RETURNING id AS id, first_name AS firstName",
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds a delete statement with hasMany include in RETURNING", () => {
    const query = buildDeleteQuery(
      usersTable,
      { posts: many(() => postsTable) },
      {
        where: { id: "user-1" },
        include: { posts: true },
      },
    );

    expect(query.statement).toBe(
      "DELETE FROM users WHERE id = ? RETURNING id AS id, first_name AS firstName, created_at AS createdAt, COALESCE((SELECT json_group_array(json_object('id', posts__posts.id, 'title', posts__posts.title, 'authorId', posts__posts.author_id)) FROM posts AS posts__posts WHERE posts__posts.author_id = users.id), '[]') AS posts",
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([
      { name: "posts", type: "hasMany" },
    ]);
  });

  test("builds a delete statement with hasOne include in RETURNING", () => {
    const query = buildDeleteQuery(
      postsTable,
      { author: one(() => usersTable) },
      {
        where: { id: "post-1" },
        include: { author: true },
      },
    );

    expect(query.statement).toBe(
      "DELETE FROM posts WHERE id = ? RETURNING id AS id, title AS title, author_id AS authorId, (SELECT json_object('id', author__users.id, 'firstName', author__users.first_name, 'createdAt', author__users.created_at) FROM users AS author__users WHERE author__users.id = posts.author_id LIMIT 1) AS author",
    );
    expect(query.params).toEqual(["post-1"]);
    expect(query.includeDescriptors).toEqual([
      { name: "author", type: "hasOne" },
    ]);
  });

  test("throws when where is empty", () => {
    expect(() =>
      buildDeleteQuery(
        usersTable,
        {},
        {
          // @ts-expect-error empty object is not assignable to FindUniqueWhere
          where: {},
        },
      ),
    ).toThrow("findUnique requires at least one where key");
  });

  test("throws when where has no unique or primary key column", () => {
    expect(() =>
      buildDeleteQuery(
        usersTable,
        {},
        {
          // @ts-expect-error firstName alone does not satisfy FindUniqueWhere (no unique key)
          where: {
            firstName: "John",
          },
        },
      ),
    ).toThrow(
      "findUnique where must include at least one unique or primary key column",
    );
  });
});

describe("createSqliteDialect - delete", () => {
  test("deletes a row and returns the deleted record", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const deleted = await dialect.delete(sql, { where: { id: "user-1" } });

    expect(deleted.id).toBe("user-1");
    expect(deleted.firstName).toBe("John");

    const remaining = await dialect.findUnique(sql, {
      where: { id: "user-1" },
    });

    expect(remaining).toBeNull();

    await sql.close();
  });

  test("deletes only the matching row", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    await dialect.delete(sql, { where: { id: "user-1" } });

    const remaining = await dialect.findUnique(sql, {
      where: { id: "user-2" },
    });

    expect(remaining?.firstName).toBe("Alice");

    await sql.close();
  });

  test("throws when where clause matches no rows", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});

    await expect(
      dialect.delete(sql, { where: { id: "missing" } }),
    ).rejects.toThrow("Record not found after delete on table users");

    await sql.close();
  });

  test("returns only selected fields", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const deleted = await dialect.delete(sql, {
      where: { id: "user-1" },
      select: { id: true, firstName: true },
    });

    expect(deleted).toEqual({ id: "user-1", firstName: "John" });

    await sql.close();
  });

  test("returns include relations on the deleted record", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertPost(sql, "post-1", "Hello", "user-1");

    const dialect = createSqliteDialect(usersTable, {
      posts: many(() => postsTable),
    });

    const deleted = await dialect.delete(sql, {
      where: { id: "user-1" },
      include: { posts: true },
    });

    expect(deleted.id).toBe("user-1");
    expect(deleted.posts).toEqual([
      { id: "post-1", title: "Hello", authorId: "user-1" },
    ]);

    await sql.close();
  });
});

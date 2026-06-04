import { describe, expect, test } from "bun:test";
import {
  boolean,
  date,
  enumType,
  json,
  jsonb,
  string,
  uuid,
} from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import {
  buildCreateManyQuery,
  buildCreateQuery,
  buildDeleteManyQuery,
  buildDeleteQuery,
  buildFindFirstQuery,
  buildFindManyQuery,
  buildFindUniqueQuery,
  buildUpdateManyQuery,
  buildUpdateQuery,
  type IncludeDescriptor,
  parseIncludeRows,
} from "./shared.js";
import { createSqliteDialect, SQLITE_SPEC } from "./sqlite.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  firstName: string("first_name").notNull(),
  createdAt: date("created_at").notNull(),
  isActive: boolean("is_active")
    .notNull()
    .default(() => true),
});

const postsTable = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => usersTable.columns.id),
});

const CREATE_USERS_TABLE_SQL =
  "CREATE TABLE users (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, created_at TEXT NOT NULL, is_active INTEGER NOT NULL)";

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
  isActive = true,
) => {
  await sql.unsafe(
    "INSERT INTO users (id, first_name, created_at, is_active) VALUES (?, ?, ?, ?)",
    [id, firstName, createdAt, isActive],
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
  test("supports enumType direct equality and equals operator", () => {
    const accountsTable = defineTable("accounts", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["active", "inactive"]).notNull(),
    });

    const directValueQuery = buildFindManyQuery(
      SQLITE_SPEC,
      accountsTable,
      {},
      {
        where: {
          status: "active",
        },
      },
    );

    expect(directValueQuery.statement).toBe(
      'SELECT "id" AS "id", "status" AS "status" FROM "accounts" WHERE "status" = ?',
    );
    expect(directValueQuery.params).toEqual(["active"]);

    const equalsQuery = buildFindManyQuery(
      SQLITE_SPEC,
      accountsTable,
      {},
      {
        where: {
          status: {
            equals: "inactive",
          },
        },
      },
    );

    expect(equalsQuery.statement).toBe(
      'SELECT "id" AS "id", "status" AS "status" FROM "accounts" WHERE "status" = ?',
    );
    expect(equalsQuery.params).toEqual(["inactive"]);
  });

  test("builds a select statement with where operators, ordering, and pagination", () => {
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");

    const query = buildFindManyQuery(
      SQLITE_SPEC,
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
      'SELECT "id" AS "id", "first_name" AS "firstName" FROM "users" WHERE "first_name" LIKE ? ESCAPE \'\\\' AND "created_at" >= ? ORDER BY "created_at" DESC, "first_name" ASC LIMIT ? OFFSET ?',
    );
    expect(query.params).toEqual(["Jo%", createdAfter.toISOString(), 10, 5]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("escapes LIKE metacharacters for startsWith, endsWith, and contains", () => {
    const query = buildFindManyQuery(
      SQLITE_SPEC,
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
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "first_name" LIKE ? ESCAPE \'\\\' AND "first_name" LIKE ? ESCAPE \'\\\' AND "first_name" LIKE ? ESCAPE \'\\\'',
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
      SQLITE_SPEC,
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
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "id" = ? AND "created_at" = ? AND "first_name" IS NULL',
    );
    expect(query.params).toEqual([idList, createdAt.toISOString()]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds offset-only pagination with LIMIT -1 OFFSET", () => {
    const query = buildFindManyQuery(SQLITE_SPEC, usersTable, {}, { skip: 3 });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" LIMIT -1 OFFSET ?',
    );
    expect(query.params).toEqual([3]);
  });

  test("falls back to full column list when select is an empty object", () => {
    const query = buildFindManyQuery(
      SQLITE_SPEC,
      usersTable,
      {},
      { select: {} },
    );

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users"',
    );
    expect(query.params).toEqual([]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds hasMany include subquery SQL", () => {
    const query = buildFindManyQuery(
      SQLITE_SPEC,
      usersTable,
      { posts: many(() => postsTable) },
      {
        include: { posts: true },
      },
    );

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive", COALESCE((SELECT json_group_array(json_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id"), \'[]\') AS "posts" FROM "users"',
    );
    expect(query.params).toEqual([]);
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "posts", type: "hasMany" }),
    ]);
  });

  test("builds hasOne include subquery SQL", () => {
    const query = buildFindManyQuery(
      SQLITE_SPEC,
      postsTable,
      { author: one("authorId", () => usersTable) },
      {
        include: { author: true },
      },
    );

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "title" AS "title", "author_id" AS "authorId", (SELECT json_object(\'id\', author__users."id", \'firstName\', author__users."first_name", \'createdAt\', author__users."created_at", \'isActive\', author__users."is_active") FROM "users" AS author__users WHERE author__users."id" = "posts"."author_id" LIMIT 1) AS "author" FROM "posts"',
    );
    expect(query.params).toEqual([]);
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "author", type: "hasOne" }),
    ]);
  });

  test("ignores disabled include flags and supports take-only pagination", () => {
    const query = buildFindManyQuery(
      SQLITE_SPEC,
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
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" LIMIT ?',
    );
    expect(query.params).toEqual([2]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("throws for unknown relation names", () => {
    expect(() =>
      buildFindManyQuery(
        SQLITE_SPEC,
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
        SQLITE_SPEC,
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
        SQLITE_SPEC,
        usersTable,
        { memberships: many(() => membershipsTable) },
        {
          include: { memberships: true },
        },
      ),
    ).toThrow("Ambiguous hasMany foreign key from memberships to users");
  });

  test("builds hasMany include subquery SQL joining on a non-PK column", () => {
    const groupsTable = defineTable("groups", {
      code: string("code").notNull().unique(),
      name: string("name").notNull(),
    });

    const membersTable = defineTable("members", {
      id: uuid("id").primaryKey().notNull(),
      groupCode: string("group_code").references(
        () => groupsTable.columns.code,
      ),
    });

    const query = buildFindManyQuery(
      SQLITE_SPEC,
      groupsTable,
      { members: many(() => membersTable) },
      { include: { members: true } },
    );

    expect(query.statement).toBe(
      'SELECT "code" AS "code", "name" AS "name", COALESCE((SELECT json_group_array(json_object(\'id\', members__members."id", \'groupCode\', members__members."group_code")) FROM "members" AS members__members WHERE members__members."group_code" = "groups"."code"), \'[]\') AS "members" FROM "groups"',
    );
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "members", type: "hasMany" }),
    ]);
  });

  test("throws when hasOne local foreign key column is missing", () => {
    const profilesTable = defineTable("profiles", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio").notNull(),
    });

    expect(() =>
      buildFindManyQuery(
        SQLITE_SPEC,
        usersTable,
        { profile: one("profileId", () => profilesTable) },
        {
          include: { profile: true },
        },
      ),
    ).toThrow("Missing hasOne foreign key column profileId on users");
  });

  test("throws when hasOne column is not a foreign key", () => {
    const profilesTable = defineTable("profiles", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio").notNull(),
    });

    expect(() =>
      buildFindManyQuery(
        SQLITE_SPEC,
        usersTable,
        { profile: one("firstName", () => profilesTable) },
        {
          include: { profile: true },
        },
      ),
    ).toThrow("Column firstName on users is not a foreign key");
  });

  test("throws on unknown where key", () => {
    expect(() =>
      buildFindManyQuery(
        SQLITE_SPEC,
        usersTable,
        {},
        // @ts-expect-error testing invalid where key
        { where: { nonExistent: "x" } },
      ),
    ).toThrow('Unknown where key "nonExistent" on table users');
  });

  test("JSON.stringifies objects/arrays in json and jsonb where clauses", () => {
    const eventsTable = defineTable("events", {
      id: uuid("id").primaryKey().notNull(),
      payload: json("payload").notNull(),
      meta: jsonb("meta").notNull(),
    });

    const obj = { type: "click", x: 10 };
    const arr = [1, 2, 3];

    const query = buildFindManyQuery(
      SQLITE_SPEC,
      eventsTable,
      {},
      {
        where: {
          payload: arr,
          meta: { equals: obj },
        },
      },
    );

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "payload" AS "payload", "meta" AS "meta" FROM "events" WHERE "payload" = ? AND "meta" = ?',
    );
    expect(query.params).toEqual([JSON.stringify(arr), JSON.stringify(obj)]);
  });
});

describe("buildFindUniqueQuery", () => {
  test("builds a select statement with LIMIT 1", () => {
    const query = buildFindUniqueQuery(
      SQLITE_SPEC,
      usersTable,
      {},
      {
        where: {
          id: "user-1",
        },
      },
    );

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "id" = ? LIMIT 1',
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("allows non-unique guard fields alongside a unique key", () => {
    const query = buildFindUniqueQuery(
      SQLITE_SPEC,
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
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "id" = ? AND "first_name" = ? LIMIT 1',
    );
    expect(query.params).toEqual(["user-1", "John"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("throws when runtime where payload is empty", () => {
    expect(() =>
      buildFindUniqueQuery(
        SQLITE_SPEC,
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
        SQLITE_SPEC,
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
        SQLITE_SPEC,
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

describe("buildFindFirstQuery", () => {
  test("builds a select statement with LIMIT 1", () => {
    const query = buildFindFirstQuery(
      SQLITE_SPEC,
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
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "first_name" LIKE ? ESCAPE \'\\\' ORDER BY "created_at" DESC LIMIT ?',
    );
    expect(query.params).toEqual(["Jo%", 1]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("supports include and skip while limiting to one row", () => {
    const query = buildFindFirstQuery(
      SQLITE_SPEC,
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
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive", COALESCE((SELECT json_group_array(json_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id"), \'[]\') AS "posts" FROM "users" LIMIT ? OFFSET ?',
    );
    expect(query.params).toEqual([1, 2]);
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "posts", type: "hasMany" }),
    ]);
  });
});

describe("parseIncludeRows", () => {
  test("parses JSON include values and normalizes null hasMany values", () => {
    const descriptors = [
      { name: "posts", type: "hasMany", table: postsTable },
      { name: "author", type: "hasOne", table: usersTable },
    ] satisfies Array<IncludeDescriptor>;

    const rows: Array<Record<string, unknown>> = [
      { id: "u1", posts: null, author: null },
      {
        id: "u2",
        posts: '[{"id":"p1","title":"Hello"}]',
        author: '{"id":"u1","firstName":"John"}',
      },
    ];

    parseIncludeRows(usersTable, rows, descriptors);

    expect(rows).toEqual([
      { id: "u1", posts: [], author: null },
      {
        id: "u2",
        posts: [{ id: "p1", title: "Hello" }],
        author: { id: "u1", firstName: "John" },
      },
    ]);
  });

  test("coerces boolean fields in a hasOne included relation", () => {
    const descriptors = [
      { name: "author", type: "hasOne", table: usersTable },
    ] satisfies Array<IncludeDescriptor>;

    const rows: Array<Record<string, unknown>> = [
      {
        id: "p1",
        title: "Hello",
        author:
          '{"id":"u1","firstName":"John","createdAt":"2025-01-01","isActive":1}',
      },
      {
        id: "p2",
        title: "World",
        author:
          '{"id":"u2","firstName":"Jane","createdAt":"2025-01-01","isActive":0}',
      },
    ];

    parseIncludeRows(postsTable, rows, descriptors);

    expect(rows[0]?.author).toMatchObject({ isActive: true });
    expect(rows[1]?.author).toMatchObject({ isActive: false });
  });

  test("coerces boolean fields in a hasMany included relation", () => {
    const descriptors = [
      { name: "members", type: "hasMany", table: usersTable },
    ] satisfies Array<IncludeDescriptor>;

    const rows: Array<Record<string, unknown>> = [
      {
        id: "g1",
        members:
          '[{"id":"u1","firstName":"Alice","createdAt":"2025-01-01","isActive":1},{"id":"u2","firstName":"Bob","createdAt":"2025-01-01","isActive":0}]',
      },
    ];

    parseIncludeRows(postsTable, rows, descriptors);

    const members = rows[0]?.members as Array<Record<string, unknown>>;

    expect(members[0]?.isActive).toBe(true);
    expect(members[1]?.isActive).toBe(false);
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

  test("findMany returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);

    const dialect = createSqliteDialect(usersTable, {});
    const rows = await dialect.findMany(sql, {
      where: {
        id: "user-1",
      },
    });

    const [row] = rows;

    expect(row?.isActive).toBe(false);

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

  test("findUnique returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);

    const dialect = createSqliteDialect(usersTable, {});
    const row = await dialect.findUnique(sql, { where: { id: "user-1" } });

    expect(row?.isActive).toBe(false);

    await sql.close();
  });

  test("findFirst returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);

    const dialect = createSqliteDialect(usersTable, {});
    const row = await dialect.findFirst(sql, { where: { id: "user-1" } });

    expect(row?.isActive).toBe(false);

    await sql.close();
  });

  test("create returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});
    const row = await dialect.create(sql, {
      data: {
        id: "user-1",
        firstName: "John",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        isActive: false,
      },
    });

    expect(row.isActive).toBe(false);

    await sql.close();
  });
});

describe("buildUpdateQuery", () => {
  test("builds an update statement with where clause", () => {
    const query = buildUpdateQuery(
      SQLITE_SPEC,
      usersTable,
      {},
      {
        where: { id: "user-1" },
        data: { firstName: "Jane" },
      },
    );

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds an update statement with multiple set fields", () => {
    const query = buildUpdateQuery(
      SQLITE_SPEC,
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
      'UPDATE "users" SET "first_name" = ?, "created_at" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual([
      "Jane",
      "2026-01-01T00:00:00.000Z",
      "user-1",
    ]);
  });

  test("builds an update statement with select columns in RETURNING", () => {
    const query = buildUpdateQuery(
      SQLITE_SPEC,
      usersTable,
      {},
      {
        where: { id: "user-1" },
        data: { firstName: "Jane" },
        select: { id: true, firstName: true },
      },
    );

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName"',
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("throws when where is empty", () => {
    expect(() =>
      buildUpdateQuery(
        SQLITE_SPEC,
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
      SQLITE_SPEC,
      usersTable,
      {},
      {
        where: { id: "user-1" },
        // @ts-expect-error nonExistent is not a column on usersTable
        data: { firstName: "Jane", nonExistent: "value" },
      },
    );

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
  });

  test("throws when data is empty", () => {
    expect(() =>
      buildUpdateQuery(
        SQLITE_SPEC,
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
      SQLITE_SPEC,
      usersTable,
      {},
      {
        where: { id: "user-1" },
        data: { createdAt: date },
      },
    );

    expect(query.statement).toBe(
      'UPDATE "users" SET "created_at" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["2026-06-01T00:00:00.000Z", "user-1"]);
  });

  test("builds an update statement with hasMany include in RETURNING", () => {
    const query = buildUpdateQuery(
      SQLITE_SPEC,
      usersTable,
      { posts: many(() => postsTable) },
      {
        where: { id: "user-1" },
        data: { firstName: "Jane" },
        include: { posts: true },
      },
    );

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive", COALESCE((SELECT json_group_array(json_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id"), \'[]\') AS "posts"',
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "posts", type: "hasMany" }),
    ]);
  });

  test("builds an update statement with hasOne include in RETURNING", () => {
    const query = buildUpdateQuery(
      SQLITE_SPEC,
      postsTable,
      { author: one("authorId", () => usersTable) },
      {
        where: { id: "post-1" },
        data: { title: "Updated" },
        include: { author: true },
      },
    );

    expect(query.statement).toBe(
      'UPDATE "posts" SET "title" = ? WHERE "id" = ? RETURNING "id" AS "id", "title" AS "title", "author_id" AS "authorId", (SELECT json_object(\'id\', author__users."id", \'firstName\', author__users."first_name", \'createdAt\', author__users."created_at", \'isActive\', author__users."is_active") FROM "users" AS author__users WHERE author__users."id" = "posts"."author_id" LIMIT 1) AS "author"',
    );
    expect(query.params).toEqual(["Updated", "post-1"]);
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "author", type: "hasOne" }),
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

  test("returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);

    const dialect = createSqliteDialect(usersTable, {});
    const row = await dialect.update(sql, {
      where: { id: "user-1" },
      data: { firstName: "Jane" },
    });

    expect(row.isActive).toBe(false);

    await sql.close();
  });
});

describe("buildDeleteQuery", () => {
  test("builds a delete statement with where clause", () => {
    const query = buildDeleteQuery(
      SQLITE_SPEC,
      usersTable,
      {},
      { where: { id: "user-1" } },
    );

    expect(query.statement).toBe(
      'DELETE FROM "users" WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds a delete statement with select columns in RETURNING", () => {
    const query = buildDeleteQuery(
      SQLITE_SPEC,
      usersTable,
      {},
      {
        where: { id: "user-1" },
        select: { id: true, firstName: true },
      },
    );

    expect(query.statement).toBe(
      'DELETE FROM "users" WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName"',
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([]);
  });

  test("builds a delete statement with hasMany include in RETURNING", () => {
    const query = buildDeleteQuery(
      SQLITE_SPEC,
      usersTable,
      { posts: many(() => postsTable) },
      {
        where: { id: "user-1" },
        include: { posts: true },
      },
    );

    expect(query.statement).toBe(
      'DELETE FROM "users" WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive", COALESCE((SELECT json_group_array(json_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id"), \'[]\') AS "posts"',
    );
    expect(query.params).toEqual(["user-1"]);
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "posts", type: "hasMany" }),
    ]);
  });

  test("builds a delete statement with hasOne include in RETURNING", () => {
    const query = buildDeleteQuery(
      SQLITE_SPEC,
      postsTable,
      { author: one("authorId", () => usersTable) },
      {
        where: { id: "post-1" },
        include: { author: true },
      },
    );

    expect(query.statement).toBe(
      'DELETE FROM "posts" WHERE "id" = ? RETURNING "id" AS "id", "title" AS "title", "author_id" AS "authorId", (SELECT json_object(\'id\', author__users."id", \'firstName\', author__users."first_name", \'createdAt\', author__users."created_at", \'isActive\', author__users."is_active") FROM "users" AS author__users WHERE author__users."id" = "posts"."author_id" LIMIT 1) AS "author"',
    );
    expect(query.params).toEqual(["post-1"]);
    expect(query.includeDescriptors).toEqual([
      expect.objectContaining({ name: "author", type: "hasOne" }),
    ]);
  });

  test("throws when where is empty", () => {
    expect(() =>
      buildDeleteQuery(
        SQLITE_SPEC,
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
        SQLITE_SPEC,
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

  test("returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);

    const dialect = createSqliteDialect(usersTable, {});
    const row = await dialect.delete(sql, { where: { id: "user-1" } });

    expect(row.isActive).toBe(false);

    await sql.close();
  });
});

describe("buildCreateManyQuery", () => {
  test("builds a batched INSERT with one row", () => {
    const query = buildCreateManyQuery(SQLITE_SPEC, usersTable, {
      data: [
        {
          id: "user-1",
          firstName: "John",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      ],
    });

    expect(query.statement).toBe(
      'INSERT INTO "users" ("id", "first_name", "created_at", "is_active") VALUES (?, ?, ?, ?) RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual([
      "user-1",
      "John",
      "2025-01-01T00:00:00.000Z",
      true,
    ]);
  });

  test("builds a batched INSERT with multiple rows", () => {
    const query = buildCreateManyQuery(SQLITE_SPEC, usersTable, {
      data: [
        {
          id: "user-1",
          firstName: "John",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
        },
        {
          id: "user-2",
          firstName: "Alice",
          createdAt: new Date("2025-01-02T00:00:00.000Z"),
        },
      ],
    });

    expect(query.statement).toBe(
      'INSERT INTO "users" ("id", "first_name", "created_at", "is_active") VALUES (?, ?, ?, ?), (?, ?, ?, ?) RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual([
      "user-1",
      "John",
      "2025-01-01T00:00:00.000Z",
      true,
      "user-2",
      "Alice",
      "2025-01-02T00:00:00.000Z",
      true,
    ]);
  });

  test("serializes Date values across all rows", () => {
    const d1 = new Date("2025-03-01T00:00:00.000Z");
    const d2 = new Date("2025-04-01T00:00:00.000Z");

    const query = buildCreateManyQuery(SQLITE_SPEC, usersTable, {
      data: [
        { id: "a", firstName: "A", createdAt: d1 },
        { id: "b", firstName: "B", createdAt: d2 },
      ],
    });

    expect(query.params).toEqual([
      "a",
      "A",
      d1.toISOString(),
      true,
      "b",
      "B",
      d2.toISOString(),
      true,
    ]);
  });

  test("returns empty statement and params for empty data array", () => {
    const query = buildCreateManyQuery(SQLITE_SPEC, usersTable, { data: [] });

    expect(query.statement).toBe("");
    expect(query.params).toEqual([]);
  });

  test("uses column defaults for omitted optional fields", () => {
    const tableWithDefault = defineTable("items", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      tag: string("tag").default(() => "default-tag"),
    });

    const query = buildCreateManyQuery(SQLITE_SPEC, tableWithDefault, {
      data: [{ id: "item-1", name: "Widget" }],
    });

    expect(query.statement).toBe(
      'INSERT INTO "items" ("id", "name", "tag") VALUES (?, ?, ?) RETURNING "id" AS "id", "name" AS "name", "tag" AS "tag"',
    );
    expect(query.params).toEqual(["item-1", "Widget", "default-tag"]);
  });
});

describe("buildUpdateManyQuery", () => {
  test("builds an UPDATE without a WHERE clause when no where is provided", () => {
    const query = buildUpdateManyQuery(SQLITE_SPEC, usersTable, {
      data: { firstName: "Everyone" },
    });

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["Everyone"]);
  });

  test("builds an UPDATE with a WHERE clause", () => {
    const query = buildUpdateManyQuery(SQLITE_SPEC, usersTable, {
      where: { firstName: { startsWith: "Jo" } },
      data: { firstName: "John" },
    });

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "first_name" LIKE ? ESCAPE \'\\\' RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["John", "Jo%"]);
  });

  test("builds an UPDATE with multiple SET fields", () => {
    const query = buildUpdateManyQuery(SQLITE_SPEC, usersTable, {
      where: { id: "user-1" },
      data: {
        firstName: "Jane",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ?, "created_at" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual([
      "Jane",
      "2026-01-01T00:00:00.000Z",
      "user-1",
    ]);
  });

  test("serializes Date values in data", () => {
    const d = new Date("2026-06-01T00:00:00.000Z");

    const query = buildUpdateManyQuery(SQLITE_SPEC, usersTable, {
      data: { createdAt: d },
    });

    expect(query.params).toEqual([d.toISOString()]);
  });

  test("skips unknown data keys", () => {
    const query = buildUpdateManyQuery(SQLITE_SPEC, usersTable, {
      where: { id: "user-1" },
      // @ts-expect-error nonExistent is not a column on usersTable
      data: { firstName: "Jane", nonExistent: "value" },
    });

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["Jane", "user-1"]);
  });

  test("throws when data is empty", () => {
    expect(() =>
      buildUpdateManyQuery(SQLITE_SPEC, usersTable, {
        data: {},
      }),
    ).toThrow("updateMany requires at least one field in data");
  });
});

describe("buildDeleteManyQuery", () => {
  test("builds a DELETE without a WHERE clause when no where is provided", () => {
    const query = buildDeleteManyQuery(SQLITE_SPEC, usersTable, {});

    expect(query.statement).toBe(
      'DELETE FROM "users" RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual([]);
  });

  test("builds a DELETE with a WHERE clause", () => {
    const query = buildDeleteManyQuery(SQLITE_SPEC, usersTable, {
      where: { firstName: { startsWith: "Jo" } },
    });

    expect(query.statement).toBe(
      'DELETE FROM "users" WHERE "first_name" LIKE ? ESCAPE \'\\\' RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["Jo%"]);
  });

  test("builds a DELETE with an equality WHERE clause", () => {
    const query = buildDeleteManyQuery(SQLITE_SPEC, usersTable, {
      where: { firstName: "John" },
    });

    expect(query.statement).toBe(
      'DELETE FROM "users" WHERE "first_name" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["John"]);
  });

  test("serializes Date values in where clause", () => {
    const cutoff = new Date("2025-01-01T00:00:00.000Z");

    const query = buildDeleteManyQuery(SQLITE_SPEC, usersTable, {
      where: { createdAt: { lt: cutoff } },
    });

    expect(query.statement).toBe(
      'DELETE FROM "users" WHERE "created_at" < ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual([cutoff.toISOString()]);
  });
});

describe("createSqliteDialect - createMany", () => {
  test("inserts multiple rows and returns the inserted records", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.createMany(sql, {
      data: [
        { id: "user-1", firstName: "John", createdAt: new Date() },
        { id: "user-2", firstName: "Alice", createdAt: new Date() },
        { id: "user-3", firstName: "Bob", createdAt: new Date() },
      ],
    });

    expect(result).toHaveLength(3);
    expect(result[0]?.id).toBe("user-1");
    expect(result[1]?.id).toBe("user-2");
    expect(result[2]?.id).toBe("user-3");

    await sql.close();
  });

  test("inserts a single row and returns the inserted record", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.createMany(sql, {
      data: [{ id: "user-1", firstName: "Solo", createdAt: new Date() }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("user-1");
    expect(result[0]?.firstName).toBe("Solo");

    await sql.close();
  });

  test("returns an empty array for empty data without executing a query", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.createMany(sql, { data: [] });

    expect(result).toEqual([]);

    const rows = await dialect.findMany(sql);

    expect(rows).toHaveLength(0);

    await sql.close();
  });

  test("persists all inserted rows with correct values", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});

    const d1 = new Date("2025-01-01T00:00:00.000Z");
    const d2 = new Date("2025-06-01T00:00:00.000Z");

    await dialect.createMany(sql, {
      data: [
        { id: "user-1", firstName: "John", createdAt: d1 },
        { id: "user-2", firstName: "Alice", createdAt: d2 },
      ],
    });

    const john = await dialect.findUnique(sql, { where: { id: "user-1" } });
    const alice = await dialect.findUnique(sql, { where: { id: "user-2" } });

    expect(john?.firstName).toBe("John");
    expect(new Date(john?.createdAt ?? 0).toISOString()).toBe(d1.toISOString());
    expect(alice?.firstName).toBe("Alice");
    expect(new Date(alice?.createdAt ?? 0).toISOString()).toBe(
      d2.toISOString(),
    );

    await sql.close();
  });

  test("returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect(usersTable, {});
    const rows = await dialect.createMany(sql, {
      data: [
        {
          id: "user-1",
          firstName: "John",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          isActive: false,
        },
      ],
    });

    expect(rows[0]?.isActive).toBe(false);

    await sql.close();
  });
});

describe("createSqliteDialect - updateMany", () => {
  test("updates all rows when no where is provided and returns the updated records", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");
    await insertUser(sql, "user-3", "Bob", "2025-01-03T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.updateMany(sql, {
      data: { firstName: "Updated" },
    });

    expect(result).toHaveLength(3);
    expect(result.every((r) => r.firstName === "Updated")).toBe(true);

    await sql.close();
  });

  test("updates only matching rows and returns the updated records", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Johnny", "2025-01-02T00:00:00.000Z");
    await insertUser(sql, "user-3", "Alice", "2025-01-03T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.updateMany(sql, {
      where: { firstName: { startsWith: "Jo" } },
      data: { firstName: "Jo-updated" },
    });

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.firstName === "Jo-updated")).toBe(true);

    const alice = await dialect.findUnique(sql, { where: { id: "user-3" } });

    expect(alice?.firstName).toBe("Alice");

    await sql.close();
  });

  test("returns an empty array when where clause matches no rows", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.updateMany(sql, {
      where: { firstName: "Nobody" },
      data: { firstName: "Ghost" },
    });

    expect(result).toEqual([]);

    const john = await dialect.findUnique(sql, { where: { id: "user-1" } });

    expect(john?.firstName).toBe("John");

    await sql.close();
  });

  test("serializes Date values in data", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const newDate = new Date("2026-06-01T00:00:00.000Z");

    await dialect.updateMany(sql, {
      where: { id: "user-1" },
      data: { createdAt: newDate },
    });

    const updated = await dialect.findUnique(sql, { where: { id: "user-1" } });

    expect(new Date(updated?.createdAt ?? 0).toISOString()).toBe(
      newDate.toISOString(),
    );

    await sql.close();
  });

  test("returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);

    const dialect = createSqliteDialect(usersTable, {});
    const rows = await dialect.updateMany(sql, {
      where: { id: "user-1" },
      data: { firstName: "John" },
    });

    expect(rows[0]?.isActive).toBe(false);

    await sql.close();
  });
});

describe("createSqliteDialect - deleteMany", () => {
  test("deletes all rows when no where is provided and returns the deleted records", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.deleteMany(sql, {});

    expect(result).toHaveLength(2);

    const rows = await dialect.findMany(sql);

    expect(rows).toHaveLength(0);

    await sql.close();
  });

  test("deletes only matching rows and returns the deleted records", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Johnny", "2025-01-02T00:00:00.000Z");
    await insertUser(sql, "user-3", "Alice", "2025-01-03T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.deleteMany(sql, {
      where: { firstName: { startsWith: "Jo" } },
    });

    expect(result).toHaveLength(2);

    const remaining = await dialect.findMany(sql);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.firstName).toBe("Alice");

    await sql.close();
  });

  test("returns an empty array when where clause matches no rows", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.deleteMany(sql, {
      where: { firstName: "Nobody" },
    });

    expect(result).toEqual([]);

    const rows = await dialect.findMany(sql);

    expect(rows).toHaveLength(1);

    await sql.close();
  });

  test("deletes rows matching a date range", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "Old1", "2020-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Old2", "2021-01-01T00:00:00.000Z");
    await insertUser(sql, "user-3", "New1", "2025-01-01T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.deleteMany(sql, {
      where: { createdAt: { lt: new Date("2023-01-01T00:00:00.000Z") } },
    });

    expect(result).toHaveLength(2);

    const remaining = await dialect.findMany(sql);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("user-3");

    await sql.close();
  });

  test("deletes rows by exact equality", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");

    const dialect = createSqliteDialect(usersTable, {});

    const result = await dialect.deleteMany(sql, {
      where: { firstName: "John" },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.firstName).toBe("John");

    const remaining = await dialect.findMany(sql);

    expect(remaining[0]?.firstName).toBe("Alice");

    await sql.close();
  });

  test("returns boolean fields as booleans", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);

    const dialect = createSqliteDialect(usersTable, {});
    const rows = await dialect.deleteMany(sql, { where: { id: "user-1" } });

    expect(rows[0]?.isActive).toBe(false);

    await sql.close();
  });
});

const postsWithFeaturedTable = defineTable("posts_with_featured", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
  isFeatured: boolean("is_featured")
    .notNull()
    .default(() => false),
  authorId: uuid("author_id")
    .notNull()
    .references(() => usersTable.columns.id),
});

const CREATE_POSTS_WITH_FEATURED_TABLE_SQL =
  "CREATE TABLE posts_with_featured (id TEXT PRIMARY KEY, title TEXT NOT NULL, is_featured INTEGER NOT NULL, author_id TEXT NOT NULL)";

const createPostsWithFeaturedTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_POSTS_WITH_FEATURED_TABLE_SQL);
};

const insertPostWithFeatured = async (
  sql: Bun.SQL,
  id: string,
  title: string,
  isFeatured: boolean,
  authorId: string,
) => {
  await sql.unsafe(
    "INSERT INTO posts_with_featured (id, title, is_featured, author_id) VALUES (?, ?, ?, ?)",
    [id, title, isFeatured, authorId],
  );
};

const nullableFlagsTable = defineTable("flags", {
  id: uuid("id").primaryKey().notNull(),
  isEnabled: boolean("is_enabled"),
});

const CREATE_FLAGS_TABLE_SQL =
  "CREATE TABLE flags (id TEXT PRIMARY KEY, is_enabled INTEGER)";

const createFlagsTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_FLAGS_TABLE_SQL);
};

describe("coerceBooleanColumns - nullable boolean", () => {
  test("findMany preserves null for nullable boolean column", async () => {
    const sql = createMemorySql();

    await createFlagsTable(sql);
    await sql.unsafe("INSERT INTO flags (id, is_enabled) VALUES (?, ?)", [
      "flag-1",
      null,
    ]);

    const dialect = createSqliteDialect(nullableFlagsTable, {});
    const rows = await dialect.findMany(sql);

    expect(rows[0]?.isEnabled).toBeNull();

    await sql.close();
  });

  test("findMany coerces non-null integer to boolean", async () => {
    const sql = createMemorySql();

    await createFlagsTable(sql);
    await sql.unsafe("INSERT INTO flags (id, is_enabled) VALUES (?, ?)", [
      "flag-1",
      0,
    ]);
    await sql.unsafe("INSERT INTO flags (id, is_enabled) VALUES (?, ?)", [
      "flag-2",
      1,
    ]);

    const dialect = createSqliteDialect(nullableFlagsTable, {});
    const rows = await dialect.findMany(sql, { orderBy: { id: "asc" } });

    expect(rows[0]?.isEnabled).toBe(false);
    expect(rows[1]?.isEnabled).toBe(true);

    await sql.close();
  });

  test("findUnique preserves null for nullable boolean column", async () => {
    const sql = createMemorySql();

    await createFlagsTable(sql);
    await sql.unsafe("INSERT INTO flags (id, is_enabled) VALUES (?, ?)", [
      "flag-1",
      null,
    ]);

    const dialect = createSqliteDialect(nullableFlagsTable, {});
    const row = await dialect.findUnique(sql, { where: { id: "flag-1" } });

    expect(row?.isEnabled).toBeNull();

    await sql.close();
  });

  test("create preserves null for nullable boolean column", async () => {
    const sql = createMemorySql();

    await createFlagsTable(sql);

    const dialect = createSqliteDialect(nullableFlagsTable, {});
    const row = await dialect.create(sql, {
      data: { id: "flag-1" },
    });

    expect(row.isEnabled).toBeNull();

    await sql.close();
  });
});

describe("boolean coercion in included relations", () => {
  test("findMany coerces booleans in a hasMany relation", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsWithFeaturedTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertPostWithFeatured(sql, "post-1", "Hello", true, "user-1");
    await insertPostWithFeatured(sql, "post-2", "World", false, "user-1");

    const dialect = createSqliteDialect(usersTable, {
      posts: many(() => postsWithFeaturedTable),
    });

    const rows = await dialect.findMany(sql, { include: { posts: true } });

    const posts = rows[0]?.posts as Array<Record<string, unknown>>;

    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.isFeatured)).toEqual(
      expect.arrayContaining([true, false]),
    );

    await sql.close();
  });

  test("findMany coerces booleans in a hasOne relation", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsWithFeaturedTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);
    await insertPostWithFeatured(sql, "post-1", "Hello", true, "user-1");

    const dialect = createSqliteDialect(postsWithFeaturedTable, {
      author: one("authorId", () => usersTable),
    });

    const rows = await dialect.findMany(sql, { include: { author: true } });

    const author = rows[0]?.author as Record<string, unknown>;

    expect(author.isActive).toBe(false);

    await sql.close();
  });
});

type Meta = { isActive: boolean; score: number };

const metaTable = defineTable("meta_table", {
  id: uuid("id").primaryKey().notNull(),
  meta: json<Meta>("meta").notNull(),
  extra: jsonb<{ tags: string[] }>("extra").nullable(),
});

const CREATE_META_TABLE_SQL =
  "CREATE TABLE meta_table (id TEXT PRIMARY KEY, meta TEXT NOT NULL, extra TEXT)";

const createMetaTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_META_TABLE_SQL);
};

describe("json and jsonb columns", () => {
  test("buildCreateQuery serializes json values as JSON strings", () => {
    const query = buildCreateQuery(
      SQLITE_SPEC,
      metaTable,
      {},
      {
        data: {
          id: "row-1",
          meta: { isActive: true, score: 42 },
        },
      },
    );

    expect(query.params[1]).toBe(JSON.stringify({ isActive: true, score: 42 }));
    expect(query.params[2]).toBeNull();
  });

  test("buildUpdateQuery serializes json values as JSON strings", () => {
    const query = buildUpdateQuery(
      SQLITE_SPEC,
      metaTable,
      {},
      {
        where: { id: "row-1" },
        data: { meta: { isActive: false, score: 0 } },
      },
    );

    expect(query.params[0]).toBe(JSON.stringify({ isActive: false, score: 0 }));
  });

  test("buildCreateManyQuery serializes json values across all rows", () => {
    const query = buildCreateManyQuery(SQLITE_SPEC, metaTable, {
      data: [
        { id: "row-1", meta: { isActive: true, score: 1 } },
        { id: "row-2", meta: { isActive: false, score: 2 } },
      ],
    });

    expect(query.params[1]).toBe(JSON.stringify({ isActive: true, score: 1 }));
    expect(query.params[4]).toBe(JSON.stringify({ isActive: false, score: 2 }));
  });

  test("create and findUnique round-trips json values", async () => {
    const sql = createMemorySql();

    await createMetaTable(sql);

    const dialect = createSqliteDialect(metaTable, {});

    await dialect.create(sql, {
      data: { id: "row-1", meta: { isActive: true, score: 99 } },
    });

    const row = await dialect.findUnique(sql, { where: { id: "row-1" } });

    expect(row?.meta).toEqual({ isActive: true, score: 99 });
    expect(row?.extra).toBeNull();

    await sql.close();
  });

  test("create and findUnique round-trips jsonb values", async () => {
    const sql = createMemorySql();

    await createMetaTable(sql);

    const dialect = createSqliteDialect(metaTable, {});

    await dialect.create(sql, {
      data: {
        id: "row-1",
        meta: { isActive: true, score: 1 },
        extra: { tags: ["a", "b"] },
      },
    });

    const row = await dialect.findUnique(sql, { where: { id: "row-1" } });

    expect(row?.extra).toEqual({ tags: ["a", "b"] });

    await sql.close();
  });

  test("update persists json changes and findMany returns parsed value", async () => {
    const sql = createMemorySql();

    await createMetaTable(sql);

    const dialect = createSqliteDialect(metaTable, {});

    await dialect.create(sql, {
      data: { id: "row-1", meta: { isActive: true, score: 1 } },
    });

    await dialect.update(sql, {
      where: { id: "row-1" },
      data: { meta: { isActive: false, score: 0 } },
    });

    const rows = await dialect.findMany(sql, {});

    expect(rows[0]?.meta).toEqual({ isActive: false, score: 0 });

    await sql.close();
  });

  test("json column default is applied on create", async () => {
    const tableWithDefault = defineTable("defaults_table", {
      id: uuid("id").primaryKey().notNull(),
      meta: json<Meta>("meta")
        .notNull()
        .default(() => ({ isActive: true, score: 0 })),
    });

    const sql = createMemorySql();

    await sql.unsafe(
      "CREATE TABLE defaults_table (id TEXT PRIMARY KEY, meta TEXT NOT NULL)",
    );

    const dialect = createSqliteDialect(tableWithDefault, {});

    await dialect.create(sql, { data: { id: "row-1" } });

    const row = await dialect.findUnique(sql, { where: { id: "row-1" } });

    expect(row?.meta).toEqual({ isActive: true, score: 0 });

    await sql.close();
  });
});

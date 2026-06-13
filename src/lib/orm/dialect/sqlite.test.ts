import { describe, expect, test } from "bun:test";
import { json, jsonb, uuid } from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import { createSqliteDialect } from "./sqlite.js";
import { postsTable, usersTable } from "./test-fixtures.js";

const metaTable = defineTable("meta", {
  id: uuid("id").primaryKey().notNull(),
  payload: json("payload").notNull(),
  settings: jsonb("settings").notNull(),
});

const CREATE_USERS_TABLE_SQL =
  "CREATE TABLE users (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, created_at TEXT NOT NULL, is_active INTEGER NOT NULL)";

const CREATE_POSTS_TABLE_SQL =
  "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, author_id TEXT NOT NULL)";

const CREATE_META_TABLE_SQL =
  "CREATE TABLE meta (id TEXT PRIMARY KEY, payload TEXT NOT NULL, settings TEXT NOT NULL)";

const createMemorySql = () => {
  return new Bun.SQL(":memory:");
};

const createUsersTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_USERS_TABLE_SQL);
};

const createPostsTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_POSTS_TABLE_SQL);
};

const createMetaTable = async (sql: Bun.SQL) => {
  await sql.unsafe(CREATE_META_TABLE_SQL);
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

describe("sqlite dialect", () => {
  test("reports sqlite as its name", () => {
    const dialect = createSqliteDialect({ table: usersTable, relations: {} });

    expect(dialect.name).toBe("sqlite");
  });

  test("findMany executes with where, booleans, and hasMany include options", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z", false);
    await insertPost(sql, "post-1", "Zebra", "user-1");
    await insertPost(sql, "post-2", "Alpha", "user-1");
    await insertPost(sql, "post-3", "Beta", "user-1");

    const dialect = createSqliteDialect({
      table: usersTable,
      relations: { posts: many(() => postsTable) },
    });
    const rows = await dialect.findMany(sql, {
      where: { id: "user-1" },
      include: {
        posts: {
          select: { title: true },
          orderBy: { title: "asc" },
          take: 2,
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.isActive).toBe(false);
    expect(rows[0]?.posts).toEqual([{ title: "Alpha" }, { title: "Beta" }]);

    await sql.close();
  });

  test("findUnique, findFirst, update, and delete return expected rows", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await insertUser(sql, "user-1", "John", "2025-01-01T00:00:00.000Z");
    await insertUser(sql, "user-2", "Alice", "2025-01-02T00:00:00.000Z");

    const dialect = createSqliteDialect({ table: usersTable, relations: {} });

    const unique = await dialect.findUnique(sql, {
      where: { id: "user-1" },
    });
    const first = await dialect.findFirst(sql, {
      orderBy: { createdAt: "desc" },
    });
    const updated = await dialect.update(sql, {
      where: { id: "user-1" },
      data: { firstName: "Grace" },
    });
    const deleted = await dialect.delete(sql, {
      where: { id: "user-2" },
    });
    const missing = await dialect.findUnique(sql, {
      where: { id: "user-2" },
    });

    expect(unique?.firstName).toBe("John");
    expect(first?.id).toBe("user-2");
    expect(updated.firstName).toBe("Grace");
    expect(deleted.id).toBe("user-2");
    expect(missing).toBeNull();

    await sql.close();
  });

  test("create, createMany, updateMany, and deleteMany execute", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);

    const dialect = createSqliteDialect({ table: usersTable, relations: {} });
    const created = await dialect.create(sql, {
      data: {
        id: "user-1",
        firstName: "Ada",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    });
    const createdMany = await dialect.createMany(sql, {
      data: [
        {
          id: "user-2",
          firstName: "Grace",
          createdAt: new Date("2025-01-02T00:00:00.000Z"),
          isActive: false,
        },
        {
          id: "user-3",
          firstName: "Linus",
          createdAt: new Date("2025-01-03T00:00:00.000Z"),
          isActive: true,
        },
      ],
    });
    const updatedMany = await dialect.updateMany(sql, {
      where: { isActive: false },
      data: { firstName: "Inactive" },
    });
    const deletedMany = await dialect.deleteMany(sql, {
      where: { firstName: "Inactive" },
    });

    expect(created).toMatchObject({ id: "user-1", firstName: "Ada" });
    expect(created.isActive).toBe(true);
    expect(createdMany).toHaveLength(2);
    expect(updatedMany).toHaveLength(1);
    expect(updatedMany[0]?.firstName).toBe("Inactive");
    expect(deletedMany).toHaveLength(1);
    expect(deletedMany[0]?.id).toBe("user-2");

    await sql.close();
  });

  test("create and update parse JSON values", async () => {
    const sql = createMemorySql();

    await createMetaTable(sql);

    const dialect = createSqliteDialect({ table: metaTable, relations: {} });
    const created = await dialect.create(sql, {
      data: {
        id: "meta-1",
        payload: { tags: ["a", "b"] },
        settings: [1, 2],
      },
    });
    const updated = await dialect.update(sql, {
      where: { id: "meta-1" },
      data: {
        payload: { tags: ["c"] },
      },
    });

    expect(created.payload).toEqual({ tags: ["a", "b"] });
    expect(created.settings).toEqual([1, 2]);
    expect(updated.payload).toEqual({ tags: ["c"] });

    await sql.close();
  });

  test("hasOne includes execute and return null when missing", async () => {
    const sql = createMemorySql();

    await createUsersTable(sql);
    await createPostsTable(sql);
    await insertUser(sql, "user-1", "Ada", "2025-01-01T00:00:00.000Z");
    await insertPost(sql, "post-1", "Hello", "user-1");
    await insertPost(sql, "post-2", "Missing", "missing-user");

    const dialect = createSqliteDialect({
      table: postsTable,
      relations: { author: one("authorId", () => usersTable) },
    });
    const rows = await dialect.findMany(sql, {
      orderBy: { title: "asc" },
      include: { author: true },
    });

    expect(rows[0]?.author?.firstName).toBe("Ada");
    expect(rows[1]?.author).toBeNull();

    await sql.close();
  });
});

import { describe, expect, test } from "bun:test";
import { boolean, date, json, jsonb, string, uuid } from "../column/index.js";
import { many } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import { DialectQueryBuilder } from "./query-builder.js";
import { SQLITE_SPEC } from "./sqlite.js";

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

const eventsTable = defineTable("events", {
  id: uuid("id").primaryKey().notNull(),
  payload: json("payload").notNull(),
  meta: jsonb("meta").notNull(),
});

describe("DialectQueryBuilder", () => {
  test("builds findMany with select, include, where, order, and pagination", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: { posts: many(() => postsTable) },
    });
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");
    const query = builder.buildFindMany({
      select: { id: true, firstName: true },
      include: { posts: { where: { title: "Hello" } } },
      where: {
        firstName: { startsWith: "A" },
        createdAt: { gte: createdAfter },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 5,
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", COALESCE((SELECT json_group_array(json_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id" AND "title" = ?), \'[]\') AS "posts" FROM "users" WHERE "first_name" LIKE ? ESCAPE \'\\\' AND "created_at" >= ? ORDER BY "created_at" DESC LIMIT ? OFFSET ?',
    );
    expect(query.params).toEqual([
      "Hello",
      "A%",
      createdAfter.toISOString(),
      10,
      5,
    ]);
  });

  test("builds findUnique and findFirst with LIMIT 1", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: {},
    });

    expect(builder.buildFindUnique({ where: { id: "u-1" } }).statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "id" = ? LIMIT 1',
    );
    expect(
      builder.buildFindFirst({ where: { firstName: "Ada" } }).statement,
    ).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "first_name" = ? LIMIT ?',
    );
  });

  test("builds create with defaults and JSON serialization", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: eventsTable,
      relations: {},
    });
    const query = builder.buildCreate({
      data: {
        id: "e-1",
        payload: { tags: ["a"] },
        meta: [1, 2],
      },
    });

    expect(query.statement).toBe(
      'INSERT INTO "events" ("id", "payload", "meta") VALUES (?, ?, ?) RETURNING "id" AS "id", "payload" AS "payload", "meta" AS "meta"',
    );
    expect(query.params).toEqual(["e-1", '{"tags":["a"]}', "[1,2]"]);
  });

  test("builds update and delete with include param order", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: { posts: many(() => postsTable) },
    });
    const update = builder.buildUpdate({
      where: { id: "u-1" },
      data: { firstName: "Grace" },
      include: { posts: { where: { title: "Hello" } } },
    });
    const remove = builder.buildDelete({
      where: { id: "u-1" },
      include: { posts: { where: { title: "Hello" } } },
    });

    expect(update.statement).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "id" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive", COALESCE((SELECT json_group_array(json_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id" AND "title" = ?), \'[]\') AS "posts"',
    );
    expect(update.params).toEqual(["Grace", "u-1", "Hello"]);
    expect(remove.params).toEqual(["u-1", "Hello"]);
  });

  test("builds createMany, updateMany, and deleteMany", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: {},
    });

    expect(
      builder.buildCreateMany({
        data: [
          {
            id: "u-1",
            firstName: "Ada",
            createdAt: new Date("2025-01-01T00:00:00.000Z"),
            isActive: true,
          },
          {
            id: "u-2",
            firstName: "Grace",
            createdAt: new Date("2025-02-01T00:00:00.000Z"),
            isActive: false,
          },
        ],
      }).statement,
    ).toBe(
      'INSERT INTO "users" ("id", "first_name", "created_at", "is_active") VALUES (?, ?, ?, ?), (?, ?, ?, ?) RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(
      builder.buildUpdateMany({
        where: { isActive: false },
        data: { firstName: "Unknown" },
      }).statement,
    ).toBe(
      'UPDATE "users" SET "first_name" = ? WHERE "is_active" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(
      builder.buildDeleteMany({ where: { isActive: false } }).statement,
    ).toBe(
      'DELETE FROM "users" WHERE "is_active" = ? RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
  });

  test("rejects empty mutation payloads", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: {},
    });

    expect(() =>
      builder.buildUpdate({
        where: { id: "u-1" },
        data: {},
      }),
    ).toThrow("update requires at least one field in data");
    expect(() => builder.buildUpdateMany({ data: {} })).toThrow(
      "updateMany requires at least one field in data",
    );
    expect(builder.buildCreateMany({ data: [] })).toEqual({
      statement: "",
      params: [],
      includeDescriptors: [],
    });
  });
});

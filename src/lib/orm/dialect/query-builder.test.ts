import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { many } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import { DialectQueryBuilder } from "./query-builder.js";
import { SQLITE_SPEC } from "./sqlite.js";
import {
  buildUserPostMutationQueries,
  eventsTable,
  postsTable,
  usersTable,
} from "./test-fixtures.js";

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

  test("builds findMany with relation where filters", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: { posts: many(() => postsTable) },
    });
    const query = builder.buildFindMany({
      where: {
        posts: { none: {} },
        isActive: true,
      },
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE NOT EXISTS (SELECT 1 FROM "posts" AS where_posts__posts WHERE where_posts__posts."author_id" = "users"."id" AND ((1 = 1))) AND "is_active" = ?',
    );
    expect(query.params).toEqual([true]);
  });

  test("builds findMany with distinct", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: postsTable,
      relations: {},
    });
    const query = builder.buildFindMany({
      distinct: ["title"],
      select: { id: true, title: true },
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "title" AS "title" FROM "posts" GROUP BY "title"',
    );
    expect(query.params).toEqual([]);
    expect(() =>
      builder.buildFindMany({
        // @ts-expect-error invalid runtime key
        distinct: ["missing"],
      }),
    ).toThrow('Unknown distinct key "missing" on table posts');
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

  test("builds findMany with cursor, skip, and negative take", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: {},
    });
    const forward = builder.buildFindMany({
      cursor: { id: "u-2" },
      orderBy: { id: "asc" },
      take: 10,
      skip: 1,
    });
    const backward = builder.buildFindMany({
      cursor: { id: "u-2" },
      orderBy: { id: "asc" },
      take: -5,
    });
    const negativeOnly = builder.buildFindMany({
      take: -3,
    });

    expect(forward.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "id" >= ? ORDER BY "id" ASC LIMIT ? OFFSET ?',
    );
    expect(forward.params).toEqual(["u-2", 10, 1]);
    expect(backward.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "id" <= ? ORDER BY "id" DESC LIMIT ?',
    );
    expect(backward.params).toEqual(["u-2", 5]);
    expect(negativeOnly.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" ORDER BY "id" DESC LIMIT ?',
    );
    expect(negativeOnly.params).toEqual([3]);
    expect(() =>
      builder.buildFindMany({
        cursor: { id: "u-2" },
        orderBy: { firstName: "asc" },
        take: 2,
      }),
    ).toThrow('orderBy must include cursor key "id" on table users');
    expect(() =>
      builder.buildFindMany({
        cursor: { id: "u-2" },
        orderBy: { id: "asc", firstName: "asc" },
        take: 2,
      }),
    ).toThrow(
      "cursor pagination requires a single-column orderBy on table users",
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

  test("omits bound values for unspecified dbDefault columns", () => {
    const table = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        role: string("role").notNull().dbDefault("member"),
      },
    });
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table,
      relations: {},
    });
    const query = builder.buildCreate({
      data: { id: "u-1" },
    });

    expect(query.statement).toBe(
      'INSERT INTO "users" ("id", "role") VALUES (?, \'member\') RETURNING "id" AS "id", "role" AS "role"',
    );
    expect(query.params).toEqual(["u-1"]);
  });

  test("builds update and delete with include param order", () => {
    const builder = new DialectQueryBuilder({
      spec: SQLITE_SPEC,
      table: usersTable,
      relations: { posts: many(() => postsTable) },
    });
    const { update, remove } = buildUserPostMutationQueries(builder);

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
  });
});

import { describe, expect, test } from "bun:test";
import { boolean, date, string, uuid } from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import { createPostgresDialect, POSTGRES_SPEC } from "./postgres.js";
import {
  buildCreateManyQuery,
  buildCreateQuery,
  buildDeleteManyQuery,
  buildDeleteQuery,
  buildFindManyQuery,
  buildFindUniqueQuery,
  buildUpdateManyQuery,
  buildUpdateQuery,
  createDialect,
} from "./shared.js";

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

describe("postgres dialect", () => {
  test("createPostgresDialect reports postgres as its name", () => {
    const dialect = createPostgresDialect({ table: usersTable, relations: {} });

    expect(dialect.name).toBe("postgres");
  });

  test("createDialect with postgres spec uses numbered placeholders", () => {
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");

    const query = buildFindManyQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
      options: {
        where: {
          firstName: { startsWith: "Jo" },
          createdAt: { gte: createdAfter },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        skip: 5,
      },
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "first_name" LIKE $1 ESCAPE \'\\\' AND "created_at" >= $2 ORDER BY "created_at" DESC LIMIT $3 OFFSET $4',
    );
    expect(query.params).toEqual(["Jo%", createdAfter.toISOString(), 10, 5]);
  });

  test("offset-only pagination uses LIMIT ALL OFFSET", () => {
    const query = buildFindManyQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
      options: { skip: 3 },
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" LIMIT ALL OFFSET $1',
    );
    expect(query.params).toEqual([3]);
  });

  test("hasMany include uses jsonb_agg and jsonb_build_object", () => {
    const query = buildFindManyQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: { posts: many(() => postsTable) },
      options: { include: { posts: true } },
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive", COALESCE((SELECT jsonb_agg(jsonb_build_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id"), \'[]\'::jsonb) AS "posts" FROM "users"',
    );
  });

  test("hasOne include uses jsonb_build_object", () => {
    const query = buildFindManyQuery({
      spec: POSTGRES_SPEC,
      table: postsTable,
      relations: { author: one("authorId", () => usersTable) },
      options: { include: { author: true } },
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "title" AS "title", "author_id" AS "authorId", (SELECT jsonb_build_object(\'id\', author__users."id", \'firstName\', author__users."first_name", \'createdAt\', author__users."created_at", \'isActive\', author__users."is_active") FROM "users" AS author__users WHERE author__users."id" = "posts"."author_id" LIMIT 1) AS "author" FROM "posts"',
    );
  });

  test("create renumbers placeholders for insert columns", () => {
    const query = buildCreateQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
      options: {
        data: {
          id: "u-1",
          firstName: "Ada",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          isActive: true,
        },
      },
    });

    expect(query.statement).toBe(
      'INSERT INTO "users" ("id", "first_name", "created_at", "is_active") VALUES ($1, $2, $3, $4) RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual([
      "u-1",
      "Ada",
      "2025-01-01T00:00:00.000Z",
      true,
    ]);
  });

  test("update renumbers placeholders across set and where", () => {
    const query = buildUpdateQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
      options: {
        where: { id: "u-1" },
        data: { firstName: "Grace" },
      },
    });

    expect(query.statement).toBe(
      'UPDATE "users" SET "first_name" = $1 WHERE "id" = $2 RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["Grace", "u-1"]);
  });

  test("findUnique uses numbered placeholders in where clause", () => {
    const query = buildFindUniqueQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
      options: { where: { id: "u-1" } },
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "id" = $1 LIMIT 1',
    );
    expect(query.params).toEqual(["u-1"]);
  });

  test("delete renumbers placeholders", () => {
    const query = buildDeleteQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
      options: { where: { id: "u-1" } },
    });

    expect(query.statement).toBe(
      'DELETE FROM "users" WHERE "id" = $1 RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(query.params).toEqual(["u-1"]);
  });

  test("createMany renumbers placeholders across all rows", () => {
    const query = buildCreateManyQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      options: {
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
      },
    });

    expect(query.statement).toBe(
      'INSERT INTO "users" ("id", "first_name", "created_at", "is_active") VALUES ($1, $2, $3, $4), ($5, $6, $7, $8) RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
  });

  test("updateMany and deleteMany renumber placeholders", () => {
    const updateQuery = buildUpdateManyQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      options: {
        where: { isActive: false },
        data: { firstName: "Unknown" },
      },
    });

    expect(updateQuery.statement).toBe(
      'UPDATE "users" SET "first_name" = $1 WHERE "is_active" = $2 RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );

    const deleteQuery = buildDeleteManyQuery({
      spec: POSTGRES_SPEC,
      table: usersTable,
      options: {
        where: { isActive: false },
      },
    });

    expect(deleteQuery.statement).toBe(
      'DELETE FROM "users" WHERE "is_active" = $1 RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
  });

  test("dialect created via createDialect carries postgres name", () => {
    const dialect = createDialect({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
    });

    expect(dialect.name).toBe("postgres");
  });
});

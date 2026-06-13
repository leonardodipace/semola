import { describe, expect, test } from "bun:test";
import { boolean, date, string, uuid } from "../column/index.js";
import { many, one } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import { createPostgresDialect, POSTGRES_SPEC } from "./postgres.js";
import { DialectQueryBuilder } from "./query-builder.js";
import { createDialect } from "./shared.js";

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
  test("reports postgres as its name", () => {
    const dialect = createPostgresDialect({ table: usersTable, relations: {} });
    const sharedDialect = createDialect({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
    });

    expect(dialect.name).toBe("postgres");
    expect(sharedDialect.name).toBe("postgres");
  });

  test("uses numbered placeholders and postgres offset syntax", () => {
    const builder = new DialectQueryBuilder({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
    });
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");
    const query = builder.buildFindMany({
      where: {
        firstName: { startsWith: "Jo" },
        createdAt: { gte: createdAfter },
      },
      orderBy: { createdAt: "desc" },
      skip: 5,
    });

    expect(query.statement).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive" FROM "users" WHERE "first_name" LIKE $1 ESCAPE \'\\\' AND "created_at" >= $2 ORDER BY "created_at" DESC LIMIT ALL OFFSET $3',
    );
    expect(query.params).toEqual(["Jo%", createdAfter.toISOString(), 5]);
  });

  test("uses jsonb functions for hasMany and hasOne includes", () => {
    const usersBuilder = new DialectQueryBuilder({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: { posts: many(() => postsTable) },
    });
    const postsBuilder = new DialectQueryBuilder({
      spec: POSTGRES_SPEC,
      table: postsTable,
      relations: { author: one("authorId", () => usersTable) },
    });

    expect(
      usersBuilder.buildFindMany({ include: { posts: true } }).statement,
    ).toBe(
      'SELECT "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive", COALESCE((SELECT jsonb_agg(jsonb_build_object(\'id\', posts__posts."id", \'title\', posts__posts."title", \'authorId\', posts__posts."author_id")) FROM "posts" AS posts__posts WHERE posts__posts."author_id" = "users"."id"), \'[]\'::jsonb) AS "posts" FROM "users"',
    );
    expect(
      postsBuilder.buildFindMany({ include: { author: true } }).statement,
    ).toBe(
      'SELECT "id" AS "id", "title" AS "title", "author_id" AS "authorId", (SELECT jsonb_build_object(\'id\', author__users."id", \'firstName\', author__users."first_name", \'createdAt\', author__users."created_at", \'isActive\', author__users."is_active") FROM "users" AS author__users WHERE author__users."id" = "posts"."author_id" LIMIT 1) AS "author" FROM "posts"',
    );
  });

  test("numbers placeholders across returning mutations", () => {
    const builder = new DialectQueryBuilder({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: { posts: many(() => postsTable) },
    });

    expect(
      builder.buildCreate({
        data: {
          id: "u-1",
          firstName: "Ada",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          isActive: true,
        },
      }).statement,
    ).toBe(
      'INSERT INTO "users" ("id", "first_name", "created_at", "is_active") VALUES ($1, $2, $3, $4) RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );

    const update = builder.buildUpdate({
      where: { id: "u-1" },
      data: { firstName: "Grace" },
      include: { posts: { where: { title: "Hello" } } },
    });
    const remove = builder.buildDelete({
      where: { id: "u-1" },
      include: { posts: { where: { title: "Hello" } } },
    });

    expect(update.statement).toContain(
      'UPDATE "users" SET "first_name" = $1 WHERE "id" = $2 RETURNING',
    );
    expect(update.params).toEqual(["Grace", "u-1", "Hello"]);
    expect(remove.statement).toContain('DELETE FROM "users" WHERE "id" = $1');
    expect(remove.params).toEqual(["u-1", "Hello"]);
  });

  test("numbers placeholders across bulk mutations", () => {
    const builder = new DialectQueryBuilder({
      spec: POSTGRES_SPEC,
      table: usersTable,
      relations: {},
    });
    const createMany = builder.buildCreateMany({
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
    });
    const updateMany = builder.buildUpdateMany({
      where: { isActive: false },
      data: { firstName: "Unknown" },
    });
    const deleteMany = builder.buildDeleteMany({
      where: { isActive: false },
    });

    expect(createMany.statement).toBe(
      'INSERT INTO "users" ("id", "first_name", "created_at", "is_active") VALUES ($1, $2, $3, $4), ($5, $6, $7, $8) RETURNING "id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(updateMany.statement).toContain(
      'UPDATE "users" SET "first_name" = $1 WHERE "is_active" = $2',
    );
    expect(deleteMany.statement).toContain(
      'DELETE FROM "users" WHERE "is_active" = $1',
    );
  });
});

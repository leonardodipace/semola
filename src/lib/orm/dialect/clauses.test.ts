import { describe, expect, test } from "bun:test";
import {
  enumType,
  json,
  jsonb,
  number,
  string,
  uuid,
} from "../column/index.js";
import { many } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import {
  buildOrderByClause,
  buildPaginationClause,
  buildSelectColumns,
  buildSelectStatement,
  buildSetClauses,
  buildWhereClause,
  createNextPlaceholder,
  resolveCreateValue,
  serializeColumnValue,
  validateFindUniqueWhere,
} from "./clauses.js";
import { POSTGRES_SPEC } from "./postgres.js";
import { SQLITE_SPEC } from "./sqlite.js";
import { postsTable, usersTable } from "./test-fixtures.js";

describe("clauses", () => {
  test("creates dialect placeholders", () => {
    const sqlite = createNextPlaceholder(SQLITE_SPEC);
    const postgres = createNextPlaceholder(POSTGRES_SPEC);

    expect([sqlite(), sqlite()]).toEqual(["?", "?"]);
    expect([postgres(), postgres()]).toEqual(["$1", "$2"]);
  });

  test("builds select columns and rejects unknown select keys", () => {
    expect(buildSelectColumns(usersTable, { id: true, firstName: true })).toBe(
      '"id" AS "id", "first_name" AS "firstName"',
    );
    expect(buildSelectColumns(usersTable, {})).toBe(
      '"id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(() =>
      buildSelectColumns(usersTable, {
        // @ts-expect-error invalid runtime key
        nickname: true,
      }),
    ).toThrow('Unknown select key "nickname" on table users');
  });

  test("builds where operators with serialization and LIKE escaping", () => {
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");
    const nextPlaceholder = createNextPlaceholder(SQLITE_SPEC);
    const where = buildWhereClause({
      nextPlaceholder,
      table: usersTable,
      where: {
        firstName: {
          startsWith: "A%_\\",
          endsWith: "z",
          contains: "da",
        },
        createdAt: { gte: createdAfter },
      },
    });

    expect(where.sql).toBe(
      '"first_name" LIKE ? ESCAPE \'\\\' AND "first_name" LIKE ? ESCAPE \'\\\' AND "first_name" LIKE ? ESCAPE \'\\\' AND "created_at" >= ?',
    );
    expect(where.params).toEqual([
      "A\\%\\_\\\\%",
      "%z",
      "%da%",
      createdAfter.toISOString(),
    ]);
  });

  test("treats empty $or as unsatisfiable", () => {
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        $or: [],
      },
    });

    expect(where.sql).toBe("(1 = 0)");
    expect(where.params).toEqual([]);
  });

  test("treats empty $and as a no-op", () => {
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        $and: [],
      },
    });

    expect(where.sql).toBe("");
    expect(where.params).toEqual([]);
  });

  test("ignores empty $and when combined with column filters", () => {
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        id: "u-1",
        $and: [],
      },
    });

    expect(where.sql).toBe('"id" = ?');
    expect(where.params).toEqual(["u-1"]);
  });

  test("treats tautological $or branches as always true", () => {
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        $or: [{}, { id: "u-1" }],
      },
    });

    expect(where.sql).toBe("(1 = 1)");
    expect(where.params).toEqual([]);
  });

  test("accepts $and and $not as single objects", () => {
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        $and: { id: "u-1", isActive: true },
        $not: { firstName: "Blocked" },
      },
    });

    expect(where.sql).toBe(
      '(("id" = ? AND "is_active" = ?)) AND NOT (("first_name" = ?))',
    );
    expect(where.params).toEqual(["u-1", true, "Blocked"]);
  });

  test("negates each $not array entry separately", () => {
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        $not: [{ id: "u-1" }, { isActive: false }],
      },
    });

    expect(where.sql).toBe('NOT (("id" = ?)) AND NOT (("is_active" = ?))');
    expect(where.params).toEqual(["u-1", false]);
  });

  test("builds logical where clauses with nested params in order", () => {
    const createdBefore = new Date("2025-02-01T00:00:00.000Z");
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        firstName: { startsWith: "A" },
        $or: [{ firstName: { contains: "da" } }, { isActive: false }],
        $not: { createdAt: { lt: createdBefore } },
        $and: [{ id: "u-1" }, { createdAt: { gte: createdAfter } }],
      },
    });

    expect(where.sql).toBe(
      '"first_name" LIKE ? ESCAPE \'\\\' AND (("first_name" LIKE ? ESCAPE \'\\\') OR ("is_active" = ?)) AND NOT (("created_at" < ?)) AND (("id" = ?) AND ("created_at" >= ?))',
    );
    expect(where.params).toEqual([
      "A%",
      "%da%",
      false,
      createdBefore.toISOString(),
      "u-1",
      createdAfter.toISOString(),
    ]);
  });

  test("handles direct equality, null, JSON columns, and enum values", () => {
    const eventsTable = defineTable("events", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["active", "inactive"]).notNull(),
      payload: json("payload").notNull(),
      meta: jsonb("meta").notNull(),
    });
    const payload = [1, 2, 3];
    const meta = { type: "click" };
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: eventsTable,
      where: {
        status: "active",
        payload,
        meta: { equals: meta },
      },
    });

    expect(where.sql).toBe('"status" = ? AND "payload" = ? AND "meta" = ?');
    expect(where.params).toEqual([
      "active",
      JSON.stringify(payload),
      JSON.stringify(meta),
    ]);

    const nullWhere = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        // @ts-expect-error runtime null guard
        firstName: null,
      },
    });

    expect(nullWhere.sql).toBe('"first_name" IS NULL');
    expect(nullWhere.params).toEqual([]);
  });

  test("builds in and notIn operators with serialization", () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        id: { in: ["u-1", "u-2", "u-3"] },
        firstName: { notIn: ["Blocked", "Deleted"] },
        createdAt: { in: [createdAt] },
        isActive: { notIn: [false] },
      },
    });

    expect(where.sql).toBe(
      '"id" IN (?, ?, ?) AND "first_name" NOT IN (?, ?) AND "created_at" IN (?) AND "is_active" NOT IN (?)',
    );
    expect(where.params).toEqual([
      "u-1",
      "u-2",
      "u-3",
      "Blocked",
      "Deleted",
      createdAt.toISOString(),
      false,
    ]);
  });

  test("builds in and notIn for enum and json columns", () => {
    const eventsTable = defineTable("events", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["active", "inactive"]).notNull(),
      payload: json("payload").notNull(),
      meta: jsonb("meta").notNull(),
    });
    const payload = { type: "click" };
    const meta = { source: "web" };
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(POSTGRES_SPEC),
      table: eventsTable,
      where: {
        status: { in: ["active", "inactive"], notIn: ["inactive"] },
        payload: { in: [payload] },
        meta: { notIn: [meta] },
      },
    });

    expect(where.sql).toBe(
      '"status" IN ($1, $2) AND "status" NOT IN ($3) AND "payload" IN ($4) AND "meta" NOT IN ($5)',
    );
    expect(where.params).toEqual([
      "active",
      "inactive",
      "inactive",
      JSON.stringify(payload),
      JSON.stringify(meta),
    ]);
  });

  test("treats empty in as unsatisfiable and empty notIn as a no-op", () => {
    const emptyIn = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        id: { in: [] },
      },
    });

    expect(emptyIn.sql).toBe("(1 = 0)");
    expect(emptyIn.params).toEqual([]);

    const emptyNotIn = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        id: { notIn: [] },
      },
    });

    expect(emptyNotIn.sql).toBe("");
    expect(emptyNotIn.params).toEqual([]);

    const combined = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        id: "u-1",
        firstName: { notIn: [] },
      },
    });

    expect(combined.sql).toBe('"id" = ?');
    expect(combined.params).toEqual(["u-1"]);
  });

  test("rejects non-array operands for in and notIn", () => {
    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          id: {
            // @ts-expect-error runtime guard
            in: "u-1",
          },
        },
      }),
    ).toThrow("Expected array for where operator: in for field id");

    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          id: {
            // @ts-expect-error runtime guard
            notIn: "u-1",
          },
        },
      }),
    ).toThrow("Expected array for where operator: notIn for field id");
  });

  test("builds between operator with serialization", () => {
    const start = new Date("2025-01-01T00:00:00.000Z");
    const end = new Date("2025-12-31T23:59:59.999Z");
    const scoresTable = defineTable("scores", {
      id: uuid("id").primaryKey().notNull(),
      score: number("score").notNull(),
    });
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      where: {
        createdAt: { between: [start, end] },
      },
    });

    expect(where.sql).toBe('"created_at" BETWEEN ? AND ?');
    expect(where.params).toEqual([start.toISOString(), end.toISOString()]);

    const numberWhere = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(POSTGRES_SPEC),
      table: scoresTable,
      where: {
        score: { between: [10, 20] },
      },
    });

    expect(numberWhere.sql).toBe('"score" BETWEEN $1 AND $2');
    expect(numberWhere.params).toEqual([10, 20]);
  });

  test("rejects invalid operands for between", () => {
    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          createdAt: {
            // @ts-expect-error runtime guard
            between: "2025-01-01",
          },
        },
      }),
    ).toThrow(
      "Expected array for where operator: between for field createdAt",
    );

    const start = new Date("2025-01-01T00:00:00.000Z");
    const end = new Date("2025-12-31T23:59:59.999Z");

    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          createdAt: {
            // @ts-expect-error runtime guard
            between: [start],
          },
        },
      }),
    ).toThrow(
      "Expected 2-element array for where operator: between for field createdAt",
    );

    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          createdAt: {
            // @ts-expect-error runtime guard
            between: [start, end, start],
          },
        },
      }),
    ).toThrow(
      "Expected 2-element array for where operator: between for field createdAt",
    );
  });

  test("rejects unknown where keys and operators", () => {
    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        // @ts-expect-error invalid runtime key
        where: { nickname: "Ada" },
      }),
    ).toThrow('Unknown where key "nickname" on table users');

    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          firstName: {
            // @ts-expect-error invalid runtime operator
            near: "Ada",
          },
        },
      }),
    ).toThrow("Unknown where operator: near for field firstName");
  });

  test("builds relation where filters with every, some, and none", () => {
    const postsRelations = { posts: many(() => postsTable) };
    const nextPlaceholder = createNextPlaceholder(SQLITE_SPEC);

    const everyWhere = buildWhereClause({
      nextPlaceholder,
      table: usersTable,
      relations: postsRelations,
      parentAlias: '"users"',
      where: {
        posts: { every: { title: "Published" } },
      },
    });

    expect(everyWhere.sql).toBe(
      'NOT EXISTS (SELECT 1 FROM "posts" AS where_posts__posts WHERE where_posts__posts."author_id" = "users"."id" AND NOT ("title" = ?))',
    );
    expect(everyWhere.params).toEqual(["Published"]);

    const someWhere = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      relations: postsRelations,
      parentAlias: '"users"',
      where: {
        posts: { some: { title: "Hello" } },
      },
    });

    expect(someWhere.sql).toBe(
      'EXISTS (SELECT 1 FROM "posts" AS where_posts__posts WHERE where_posts__posts."author_id" = "users"."id" AND ("title" = ?))',
    );
    expect(someWhere.params).toEqual(["Hello"]);

    const noneWhere = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      relations: postsRelations,
      parentAlias: '"users"',
      where: {
        posts: { none: {} },
      },
    });

    expect(noneWhere.sql).toBe(
      'NOT EXISTS (SELECT 1 FROM "posts" AS where_posts__posts WHERE where_posts__posts."author_id" = "users"."id" AND ((1 = 1)))',
    );
    expect(noneWhere.params).toEqual([]);
  });

  test("composes relation where filters with column filters", () => {
    const postsRelations = { posts: many(() => postsTable) };
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      relations: postsRelations,
      parentAlias: '"users"',
      where: {
        isActive: true,
        posts: { some: { title: "Hello" } },
      },
    });

    expect(where.sql).toBe(
      '"is_active" = ? AND EXISTS (SELECT 1 FROM "posts" AS where_posts__posts WHERE where_posts__posts."author_id" = "users"."id" AND ("title" = ?))',
    );
    expect(where.params).toEqual([true, "Hello"]);
  });

  test("prefers column filters when a relation shares the same key", () => {
    const itemsTable = defineTable("items", {
      id: uuid("id").primaryKey().notNull(),
      tags: json<string[]>("tags").notNull(),
    });
    const tagsTable = defineTable("tags", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => itemsTable.columns.id),
    });
    const itemRelations = { tags: many(() => tagsTable) };

    const columnWhere = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: itemsTable,
      relations: itemRelations,
      parentAlias: '"items"',
      where: {
        tags: ["alpha", "beta"],
      },
    });

    expect(columnWhere.sql).toBe('"tags" = ?');
    expect(columnWhere.params).toEqual(['["alpha","beta"]']);

    const relationWhere = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: itemsTable,
      relations: itemRelations,
      parentAlias: '"items"',
      where: {
        tags: { some: { name: "alpha" } },
      },
    });

    expect(relationWhere.sql).toBe(
      'EXISTS (SELECT 1 FROM "tags" AS where_tags__tags WHERE where_tags__tags."item_id" = "items"."id" AND ("name" = ?))',
    );
    expect(relationWhere.params).toEqual(["alpha"]);
  });

  test("combines multiple relation where filters on the same relation", () => {
    const postsRelations = { posts: many(() => postsTable) };
    const where = buildWhereClause({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      relations: postsRelations,
      parentAlias: '"users"',
      where: {
        posts: {
          none: { title: "Spam" },
          every: { title: "Published" },
        },
      },
    });

    expect(where.sql).toBe(
      'NOT EXISTS (SELECT 1 FROM "posts" AS where_posts__posts WHERE where_posts__posts."author_id" = "users"."id" AND NOT ("title" = ?)) AND NOT EXISTS (SELECT 1 FROM "posts" AS where_posts__posts WHERE where_posts__posts."author_id" = "users"."id" AND ("title" = ?))',
    );
    expect(where.params).toEqual(["Published", "Spam"]);
  });

  test("rejects invalid relation where filters", () => {
    const postsRelations = { posts: many(() => postsTable) };

    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        relations: postsRelations,
        parentAlias: '"users"',
        where: {
          // @ts-expect-error relation filter must include a quantifier
          posts: {},
        },
      }),
    ).toThrow(
      "Relation where filter for posts must include at least one of every, some, or none",
    );
  });

  test("rejects invalid logical where values", () => {
    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          // @ts-expect-error runtime guard
          $or: { id: "u-1" },
        },
      }),
    ).toThrow("$or where value must be an array");

    expect(() =>
      buildWhereClause({
        nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
        table: usersTable,
        where: {
          $or: ["bad"],
        },
      }),
    ).toThrow("$or where value must contain object filters");
  });

  test("builds order and pagination fragments", () => {
    expect(
      buildOrderByClause(usersTable, { createdAt: "desc", firstName: "asc" }),
    ).toBe('"created_at" DESC, "first_name" ASC');

    const sqlitePagination = buildPaginationClause({
      spec: SQLITE_SPEC,
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      skip: 3,
    });
    const postgresPagination = buildPaginationClause({
      spec: POSTGRES_SPEC,
      nextPlaceholder: createNextPlaceholder(POSTGRES_SPEC),
      skip: 3,
    });

    expect(sqlitePagination).toEqual({
      sql: "LIMIT -1 OFFSET ?",
      params: [3],
    });
    expect(postgresPagination).toEqual({
      sql: "LIMIT ALL OFFSET $1",
      params: [3],
    });
  });

  test("builds select statements and mutation set clauses", () => {
    expect(
      buildSelectStatement({
        tableName: '"users"',
        columns: '"id" AS "id"',
        where: '"id" = ?',
        orderBy: '"id" ASC',
        pagination: "LIMIT ?",
      }),
    ).toBe(
      'SELECT "id" AS "id" FROM "users" WHERE "id" = ? ORDER BY "id" ASC LIMIT ?',
    );

    const set = buildSetClauses({
      nextPlaceholder: createNextPlaceholder(SQLITE_SPEC),
      table: usersTable,
      data: {
        firstName: "Grace",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    });

    expect(set.setClauses).toEqual(['"first_name" = ?', '"created_at" = ?']);
    expect(set.params).toEqual(["Grace", "2025-01-01T00:00:00.000Z"]);
  });

  test("validates findUnique where payloads", () => {
    expect(() => validateFindUniqueWhere(usersTable, {})).toThrow(
      "findUnique requires at least one where key",
    );
    expect(() =>
      validateFindUniqueWhere(usersTable, { firstName: "Ada" }),
    ).toThrow(
      "findUnique where must include at least one unique or primary key column",
    );
    expect(() =>
      validateFindUniqueWhere(usersTable, { id: "u-1", firstName: "Ada" }),
    ).not.toThrow();
  });

  test("resolves create defaults and serializes column values", () => {
    const isActiveColumn = usersTable.columns.isActive;

    if (!isActiveColumn) throw new Error("Missing isActive column");

    expect(resolveCreateValue(usersTable.columns.firstName, undefined)).toBe(
      null,
    );
    expect(resolveCreateValue(usersTable.columns.firstName, "Ada")).toBe("Ada");
    expect(resolveCreateValue(isActiveColumn, undefined)).toBe(true);
    expect(
      serializeColumnValue(
        defineTable("events", { payload: json("payload").notNull() }).columns
          .payload,
        { ok: true },
      ),
    ).toBe('{"ok":true}');
  });
});

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
import { PlaceholderGenerator } from "./placeholder.js";
import { POSTGRES_SPEC } from "./postgres.js";
import { SQLITE_SPEC } from "./sqlite.js";
import { postsTable, usersTable } from "./test-fixtures.js";
import { WhereBuilder } from "./where-builder.js";

describe("where-builder", () => {
  test("builds where operators with serialization and LIKE escaping", () => {
    const createdAfter = new Date("2025-01-01T00:00:00.000Z");
    const nextPlaceholder = new PlaceholderGenerator(SQLITE_SPEC).asFn();
    const where = WhereBuilder.from({
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      table: usersTable,
      where: {
        $or: [],
      },
    });

    expect(where.sql).toBe("(1 = 0)");
    expect(where.params).toEqual([]);
  });

  test("treats empty $and as a no-op", () => {
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      table: usersTable,
      where: {
        $and: [],
      },
    });

    expect(where.sql).toBe("");
    expect(where.params).toEqual([]);
  });

  test("ignores empty $and when combined with column filters", () => {
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      table: usersTable,
      where: {
        $or: [{}, { id: "u-1" }],
      },
    });

    expect(where.sql).toBe("(1 = 1)");
    expect(where.params).toEqual([]);
  });

  test("accepts $and and $not as single objects", () => {
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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

    const nullWhere = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(POSTGRES_SPEC).asFn(),
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
    const emptyIn = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      table: usersTable,
      where: {
        id: { in: [] },
      },
    });

    expect(emptyIn.sql).toBe("(1 = 0)");
    expect(emptyIn.params).toEqual([]);

    const emptyNotIn = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      table: usersTable,
      where: {
        id: { notIn: [] },
      },
    });

    expect(emptyNotIn.sql).toBe("");
    expect(emptyNotIn.params).toEqual([]);

    const combined = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      table: usersTable,
      where: {
        createdAt: { between: [start, end] },
      },
    });

    expect(where.sql).toBe('"created_at" BETWEEN ? AND ?');
    expect(where.params).toEqual([start.toISOString(), end.toISOString()]);

    const numberWhere = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(POSTGRES_SPEC).asFn(),
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
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
        table: usersTable,
        where: {
          createdAt: {
            // @ts-expect-error runtime guard
            between: "2025-01-01",
          },
        },
      }),
    ).toThrow("Expected array for where operator: between for field createdAt");

    const start = new Date("2025-01-01T00:00:00.000Z");
    const end = new Date("2025-12-31T23:59:59.999Z");

    expect(() =>
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
        table: usersTable,
        // @ts-expect-error invalid runtime key
        where: { nickname: "Ada" },
      }),
    ).toThrow('Unknown where key "nickname" on table users');

    expect(() =>
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const nextPlaceholder = new PlaceholderGenerator(SQLITE_SPEC).asFn();

    const everyWhere = WhereBuilder.from({
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

    const someWhere = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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

    const noneWhere = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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

    const columnWhere = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      table: itemsTable,
      relations: itemRelations,
      parentAlias: '"items"',
      where: {
        tags: ["alpha", "beta"],
      },
    });

    expect(columnWhere.sql).toBe('"tags" = ?');
    expect(columnWhere.params).toEqual(['["alpha","beta"]']);

    const relationWhere = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    const where = WhereBuilder.from({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
        table: usersTable,
        where: {
          // @ts-expect-error runtime guard
          $or: { id: "u-1" },
        },
      }),
    ).toThrow("$or where value must be an array");

    expect(() =>
      WhereBuilder.from({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
        table: usersTable,
        where: {
          $or: ["bad"],
        },
      }),
    ).toThrow("$or where value must contain object filters");
  });
});

import { describe, expect, test } from "bun:test";
import { enumType, json, jsonb, uuid } from "../column/index.js";
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
import { usersTable } from "./test-fixtures.js";

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

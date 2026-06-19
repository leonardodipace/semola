import { describe, expect, test } from "bun:test";
import { PlaceholderGenerator } from "./placeholder.js";
import { POSTGRES_SPEC } from "./postgres.js";
import { selectClauseBuilder } from "./select-clause.js";
import { SQLITE_SPEC } from "./sqlite.js";
import { usersTable } from "./test-fixtures.js";

describe("select-clause", () => {
  test("builds select columns and rejects unknown select keys", () => {
    expect(
      selectClauseBuilder.buildColumns(usersTable, {
        id: true,
        firstName: true,
      }),
    ).toBe('"id" AS "id", "first_name" AS "firstName"');
    expect(selectClauseBuilder.buildColumns(usersTable, {})).toBe(
      '"id" AS "id", "first_name" AS "firstName", "created_at" AS "createdAt", "is_active" AS "isActive"',
    );
    expect(() =>
      selectClauseBuilder.buildColumns(usersTable, {
        // @ts-expect-error invalid runtime key
        nickname: true,
      }),
    ).toThrow('Unknown select key "nickname" on table users');
    expect(
      selectClauseBuilder.buildColumns(usersTable, {
        id: true,
        // @ts-expect-error runtime guard for deselected column
        firstName: false,
      }),
    ).toBe('"id" AS "id"');
    expect(() =>
      selectClauseBuilder.buildColumns(usersTable, {
        // @ts-expect-error runtime guard for all-deselected select
        firstName: false,
      }),
    ).toThrow(
      "select must include at least one selected column on table users",
    );
  });
  test("builds order and pagination fragments", () => {
    expect(
      selectClauseBuilder.buildOrderBy(usersTable, {
        createdAt: "desc",
        firstName: "asc",
      }),
    ).toBe('"created_at" DESC, "first_name" ASC');

    const sqlitePagination = selectClauseBuilder.buildPagination(
      SQLITE_SPEC,
      new PlaceholderGenerator(SQLITE_SPEC).asFn(),
      undefined,
      3,
    );
    const postgresPagination = selectClauseBuilder.buildPagination(
      POSTGRES_SPEC,
      new PlaceholderGenerator(POSTGRES_SPEC).asFn(),
      undefined,
      3,
    );

    expect(sqlitePagination).toEqual({
      sql: "LIMIT -1 OFFSET ?",
      params: [3],
    });
    expect(postgresPagination).toEqual({
      sql: "LIMIT ALL OFFSET $1",
      params: [3],
    });
  });

  test("builds select statements", () => {
    expect(
      selectClauseBuilder.buildStatement({
        tableName: '"users"',
        columns: '"id" AS "id"',
        where: '"id" = ?',
        orderBy: '"id" ASC',
        pagination: "LIMIT ?",
      }),
    ).toBe(
      'SELECT "id" AS "id" FROM "users" WHERE "id" = ? ORDER BY "id" ASC LIMIT ?',
    );
  });
});

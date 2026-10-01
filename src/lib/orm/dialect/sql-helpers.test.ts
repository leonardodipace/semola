import { describe, expect, test } from "bun:test";
import { json, string } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { PlaceholderGenerator } from "./placeholder.js";
import {
  bindCreateValue,
  buildSetClauses,
  parseCursor,
  resolveCreateValue,
  resolveFindManyPagination,
  serializeColumnValue,
  validateFindUniqueWhere,
} from "./sql-helpers.js";
import { SQLITE_SPEC } from "./sqlite.js";
import { usersTable } from "./test-fixtures.js";

describe("sql-helpers", () => {
  test("builds mutation set clauses", () => {
    const set = buildSetClauses({
      nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
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
    expect(() => validateFindUniqueWhere(usersTable, { id: null })).toThrow(
      'findUnique where key "id" must be non-null on table users',
    );
  });

  test("parses cursor and resolves pagination direction", () => {
    expect(parseCursor(usersTable, { id: "u-2" })).toEqual({
      key: "id",
      value: "u-2",
      column: usersTable.columns.id,
    });
    expect(() => parseCursor(usersTable, { firstName: "Ada" })).toThrow(
      'cursor key "firstName" must be a unique or primary key column on table users',
    );

    let index = 0;
    const nextPlaceholder = () => {
      index += 1;
      return `$${index}`;
    };

    expect(
      resolveFindManyPagination({
        table: usersTable,
        cursor: { id: "u-2" },
        orderBy: { id: "asc" },
        take: 10,
        nextPlaceholder,
      }),
    ).toEqual({
      take: 10,
      orderBy: { id: "asc" },
      cursorSql: '"id" >= $1',
      cursorParams: ["u-2"],
    });
    expect(
      resolveFindManyPagination({
        table: usersTable,
        cursor: { id: "u-2" },
        orderBy: { id: "asc" },
        take: -4,
        nextPlaceholder,
      }),
    ).toEqual({
      take: 4,
      orderBy: { id: "desc" },
      cursorSql: '"id" <= $2',
      cursorParams: ["u-2"],
    });
  });

  test("rejects unknown update keys", () => {
    expect(() =>
      buildSetClauses({
        nextPlaceholder: new PlaceholderGenerator(SQLITE_SPEC).asFn(),
        table: usersTable,
        data: {
          nickname: "Ada",
        },
      }),
    ).toThrow('Unknown data key "nickname" on table users');
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
        defineTable({
          sqlName: "events",
          columns: { payload: json("payload").notNull() },
        }).columns.payload,
        { ok: true },
      ),
    ).toBe('{"ok":true}');
  });

  test("bindCreateValue inlines dbDefault SQL and binds provided values", () => {
    const role = string("role").notNull().dbDefault("member");
    const params: unknown[] = [];
    let index = 0;
    const nextPlaceholder = () => {
      index += 1;
      return `$${index}`;
    };

    expect(bindCreateValue(role, undefined, nextPlaceholder, params)).toBe(
      "'member'",
    );
    expect(params).toEqual([]);
    expect(bindCreateValue(role, "admin", nextPlaceholder, params)).toBe("$1");
    expect(params).toEqual(["admin"]);
  });
});

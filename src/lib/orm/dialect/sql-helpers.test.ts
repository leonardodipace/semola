import { describe, expect, test } from "bun:test";
import { json } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { PlaceholderGenerator } from "./placeholder.js";
import {
  buildSetClauses,
  resolveCreateValue,
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
        defineTable("events", { payload: json("payload").notNull() }).columns
          .payload,
        { ok: true },
      ),
    ).toBe('{"ok":true}');
  });
});

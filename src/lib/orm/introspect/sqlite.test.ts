import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { introspectSqlite } from "./sqlite.js";

// Queries per table: (1) table list, (2) PRAGMA table_info, (3) PRAGMA foreign_key_list.
// PRAGMA table_info row: [cid, name, type, notnull, dflt_value, pk]
// PRAGMA foreign_key_list row: [id, seq, table, from, to, on_update, on_delete, match]
function makeSql(...results: unknown[][][]): SQL {
  let i = 0;

  const tag = () => ({ values: () => Promise.resolve(results[i++] ?? []) });

  tag.unsafe = (s: string) => s;

  return tag as unknown as SQL;
}

describe("introspectSqlite", () => {
  test("returns empty list when no tables exist", async () => {
    const sql = makeSql([]);

    const [error, tables] = await introspectSqlite(sql);

    expect(error).toBeNull();
    expect(tables).toEqual([]);
  });

  test("maps TEXT / VARCHAR / CHAR to string kind", async () => {
    for (const type of ["TEXT", "VARCHAR", "CHAR", "CLOB"]) {
      const sql = makeSql([["t"]], [[0, "col", type, 0, null, 0]], []);

      const [, tables] = await introspectSqlite(sql);

      expect(tables?.[0]?.columns[0]?.kind).toBe("string");
      expect(tables?.[0]?.columns[0]?.unknownDbType).toBeNull();
    }
  });

  test("maps INTEGER / REAL / NUMERIC / FLOAT to number kind", async () => {
    for (const type of [
      "INTEGER",
      "INT",
      "BIGINT",
      "REAL",
      "FLOAT",
      "NUMERIC",
      "DECIMAL",
    ]) {
      const sql = makeSql([["t"]], [[0, "col", type, 0, null, 0]], []);

      const [, tables] = await introspectSqlite(sql);

      expect(tables?.[0]?.columns[0]?.kind).toBe("number");
    }
  });

  test("maps BOOLEAN / BOOL to boolean kind", async () => {
    for (const type of ["BOOLEAN", "BOOL"]) {
      const sql = makeSql([["t"]], [[0, "col", type, 0, null, 0]], []);

      const [, tables] = await introspectSqlite(sql);

      expect(tables?.[0]?.columns[0]?.kind).toBe("boolean");
    }
  });

  test("maps DATE / DATETIME / TIMESTAMP to date kind", async () => {
    for (const type of ["DATE", "DATETIME", "TIMESTAMP"]) {
      const sql = makeSql([["t"]], [[0, "col", type, 0, null, 0]], []);

      const [, tables] = await introspectSqlite(sql);

      expect(tables?.[0]?.columns[0]?.kind).toBe("date");
    }
  });

  test("maps JSON to json kind", async () => {
    const sql = makeSql([["t"]], [[0, "col", "JSON", 0, null, 0]], []);

    const [, tables] = await introspectSqlite(sql);

    expect(tables?.[0]?.columns[0]?.kind).toBe("json");
  });

  test("records unknownDbType for unrecognized types", async () => {
    const sql = makeSql([["t"]], [[0, "col", "CUSTOMTYPE", 0, null, 0]], []);

    const [, tables] = await introspectSqlite(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("string");
    expect(col?.unknownDbType).toBe("CUSTOMTYPE");
  });

  test("detects primaryKey from pk column", async () => {
    const sql = makeSql([["t"]], [[0, "id", "INTEGER", 1, null, 1]], []);

    const [, tables] = await introspectSqlite(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.primaryKey).toBe(true);
    expect(col?.nullable).toBe(false);
  });

  test("nullable when notnull=0 and pk=0", async () => {
    const sql = makeSql(
      [["t"]],
      [
        [0, "required", "TEXT", 1, null, 0],
        [1, "optional", "TEXT", 0, null, 0],
      ],
      [],
    );

    const [, tables] = await introspectSqlite(sql);
    const cols = tables?.[0]?.columns ?? [];

    expect(cols[0]?.nullable).toBe(false);
    expect(cols[1]?.nullable).toBe(true);
  });

  test("captures rawDefault", async () => {
    const sql = makeSql([["t"]], [[0, "status", "TEXT", 1, "'active'", 0]], []);

    const [, tables] = await introspectSqlite(sql);

    expect(tables?.[0]?.columns[0]?.rawDefault).toBe("'active'");
  });

  test("populates references from foreign_key_list", async () => {
    const sql = makeSql(
      [["posts"]],
      [[0, "user_id", "TEXT", 1, null, 0]],
      // [id, seq, table, from, to, on_update, on_delete, match]
      [[0, 0, "users", "user_id", "id", "NO ACTION", "CASCADE", "NONE"]],
    );

    const [, tables] = await introspectSqlite(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.references).toEqual({
      table: "users",
      column: "id",
      onDelete: "CASCADE",
    });
  });

  test("onDelete is null for NO ACTION delete rules", async () => {
    const sql = makeSql(
      [["posts"]],
      [[0, "user_id", "TEXT", 1, null, 0]],
      [[0, 0, "users", "user_id", "id", "NO ACTION", "NO ACTION", "NONE"]],
    );

    const [, tables] = await introspectSqlite(sql);

    expect(tables?.[0]?.columns[0]?.references?.onDelete).toBeNull();
  });

  test("handles multiple tables", async () => {
    const sql = makeSql(
      [["posts"], ["users"]],
      [[0, "id", "INTEGER", 1, null, 1]],
      [],
      [[0, "id", "INTEGER", 1, null, 1]],
      [],
    );

    const [, tables] = await introspectSqlite(sql);

    expect(tables).toHaveLength(2);
    expect(tables?.[0]?.name).toBe("posts");
    expect(tables?.[1]?.name).toBe("users");
  });

  test("returns error when table query fails", async () => {
    let i = 0;
    const sql = {
      values: () =>
        i++ === 0
          ? Promise.reject(new Error("disk I/O error"))
          : Promise.resolve([]),
    } as unknown as SQL;

    const sql2 = (() => sql) as unknown as SQL;
    (sql2 as unknown as { unsafe: (s: string) => string }).unsafe = (
      s: string,
    ) => s;

    const [error, tables] = await introspectSqlite(sql2);

    expect(tables).toBeNull();
    expect(error?.message).toContain("Failed to list tables");
  });

  test("returns error when table_info query fails", async () => {
    let i = 0;
    const tag = () => ({
      values: () => {
        if (i++ === 0) return Promise.resolve([["users"]]);
        return Promise.reject(new Error("no such table"));
      },
    });

    tag.unsafe = (s: string) => s;

    const sql = tag as unknown as SQL;
    const [error] = await introspectSqlite(sql);

    expect(error?.message).toContain("Failed to get table_info for users");
  });
});

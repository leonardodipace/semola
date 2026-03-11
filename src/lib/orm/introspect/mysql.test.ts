import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { introspectMysql } from "./mysql.js";

// Queries per table: (1) table list, (2) columns, (3) foreign keys.
// Column row: [column_name, data_type, is_nullable, column_default, column_key, extra]
// FK row: [column_name, referenced_table_name, referenced_column_name, delete_rule]
function makeSql(...results: unknown[][][]): SQL {
  let i = 0;

  const tag = () => ({ values: () => Promise.resolve(results[i++] ?? []) });

  return tag as unknown as SQL;
}

describe("introspectMysql", () => {
  test("returns empty list when no tables exist", async () => {
    const sql = makeSql([]);

    const [error, tables] = await introspectMysql(sql, "mydb");

    expect(error).toBeNull();
    expect(tables).toEqual([]);
  });

  test("maps varchar / text / char / enum to string kind", async () => {
    for (const type of [
      "varchar",
      "text",
      "char",
      "tinytext",
      "mediumtext",
      "longtext",
      "enum",
      "set",
    ]) {
      const sql = makeSql([["t"]], [["col", type, "YES", null, "", ""]], []);

      const [, tables] = await introspectMysql(sql, "mydb");

      expect(tables?.[0]?.columns[0]?.kind).toBe("string");
      expect(tables?.[0]?.columns[0]?.unknownDbType).toBeNull();
    }
  });

  test("maps int / bigint / decimal / float to number kind", async () => {
    for (const type of [
      "int",
      "tinyint",
      "smallint",
      "bigint",
      "decimal",
      "numeric",
      "float",
      "double",
      "real",
    ]) {
      const sql = makeSql([["t"]], [["col", type, "YES", null, "", ""]], []);

      const [, tables] = await introspectMysql(sql, "mydb");

      expect(tables?.[0]?.columns[0]?.kind).toBe("number");
    }
  });

  test("maps boolean / bool / bit to boolean kind", async () => {
    for (const type of ["boolean", "bool", "bit"]) {
      const sql = makeSql([["t"]], [["col", type, "YES", null, "", ""]], []);

      const [, tables] = await introspectMysql(sql, "mydb");

      expect(tables?.[0]?.columns[0]?.kind).toBe("boolean");
    }
  });

  test("maps date / datetime / timestamp / time / year to date kind", async () => {
    for (const type of ["date", "datetime", "timestamp", "time", "year"]) {
      const sql = makeSql([["t"]], [["col", type, "YES", null, "", ""]], []);

      const [, tables] = await introspectMysql(sql, "mydb");

      expect(tables?.[0]?.columns[0]?.kind).toBe("date");
    }
  });

  test("maps json to json kind", async () => {
    const sql = makeSql([["t"]], [["col", "json", "YES", null, "", ""]], []);

    const [, tables] = await introspectMysql(sql, "mydb");

    expect(tables?.[0]?.columns[0]?.kind).toBe("json");
  });

  test("records unknownDbType for unrecognized types", async () => {
    const sql = makeSql(
      [["t"]],
      [["col", "geometry", "YES", null, "", ""]],
      [],
    );

    const [, tables] = await introspectMysql(sql, "mydb");
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("string");
    expect(col?.unknownDbType).toBe("geometry");
  });

  test("detects primaryKey from column_key PRI", async () => {
    const sql = makeSql(
      [["users"]],
      [["id", "int", "NO", null, "PRI", "auto_increment"]],
      [],
    );

    const [, tables] = await introspectMysql(sql, "mydb");
    const col = tables?.[0]?.columns[0];

    expect(col?.primaryKey).toBe(true);
    expect(col?.unique).toBe(false);
  });

  test("detects unique from column_key UNI", async () => {
    const sql = makeSql(
      [["users"]],
      [["email", "varchar", "NO", null, "UNI", ""]],
      [],
    );

    const [, tables] = await introspectMysql(sql, "mydb");
    const col = tables?.[0]?.columns[0];

    expect(col?.primaryKey).toBe(false);
    expect(col?.unique).toBe(true);
  });

  test("detects nullable from is_nullable YES/NO", async () => {
    const sql = makeSql(
      [["t"]],
      [
        ["required", "varchar", "NO", null, "", ""],
        ["optional", "varchar", "YES", null, "", ""],
      ],
      [],
    );

    const [, tables] = await introspectMysql(sql, "mydb");
    const cols = tables?.[0]?.columns ?? [];

    expect(cols[0]?.nullable).toBe(false);
    expect(cols[1]?.nullable).toBe(true);
  });

  test("captures rawDefault", async () => {
    const sql = makeSql(
      [["t"]],
      [["status", "varchar", "NO", "active", "", ""]],
      [],
    );

    const [, tables] = await introspectMysql(sql, "mydb");

    expect(tables?.[0]?.columns[0]?.rawDefault).toBe("active");
  });

  test("populates references from foreign key rows", async () => {
    const sql = makeSql(
      [["posts"]],
      [["user_id", "int", "NO", null, "MUL", ""]],
      [["user_id", "users", "id", "CASCADE"]],
    );

    const [, tables] = await introspectMysql(sql, "mydb");
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
      [["user_id", "int", "NO", null, "MUL", ""]],
      [["user_id", "users", "id", "NO ACTION"]],
    );

    const [, tables] = await introspectMysql(sql, "mydb");

    expect(tables?.[0]?.columns[0]?.references?.onDelete).toBeNull();
  });

  test("handles multiple tables", async () => {
    const sql = makeSql(
      [["orders"], ["users"]],
      [["id", "int", "NO", null, "PRI", ""]],
      [],
      [["id", "int", "NO", null, "PRI", ""]],
      [],
    );

    const [, tables] = await introspectMysql(sql, "mydb");

    expect(tables).toHaveLength(2);
    expect(tables?.[0]?.name).toBe("orders");
    expect(tables?.[1]?.name).toBe("users");
  });

  test("returns error when table query fails", async () => {
    let i = 0;
    const sql = (() => ({
      values: () =>
        i++ === 0
          ? Promise.reject(new Error("access denied"))
          : Promise.resolve([]),
    })) as unknown as SQL;

    const [error, tables] = await introspectMysql(sql, "mydb");

    expect(tables).toBeNull();
    expect(error?.message).toContain("Failed to list tables");
    expect(error?.message).toContain("access denied");
  });

  test("returns error when column query fails", async () => {
    let i = 0;
    const sql = (() => ({
      values: () => {
        if (i++ === 0) return Promise.resolve([["users"]]);
        return Promise.reject(new Error("unknown column"));
      },
    })) as unknown as SQL;

    const [error] = await introspectMysql(sql, "mydb");

    expect(error?.message).toContain("Failed to list columns for users");
  });
});

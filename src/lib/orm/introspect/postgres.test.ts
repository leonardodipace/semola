import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { introspectPostgres } from "./postgres.js";

// Each call to sql`...` in postgres.ts returns an object with .values().
// Order per table: (1) table list, (2) columns, (3) constraints, (4) foreign keys.
function makeSql(...results: unknown[][][]): SQL {
  let i = 0;

  const tag = () => ({ values: () => Promise.resolve(results[i++] ?? []) });

  return tag as unknown as SQL;
}

describe("introspectPostgres", () => {
  test("returns empty list when no tables exist", async () => {
    const sql = makeSql([]);

    const [error, tables] = await introspectPostgres(sql);

    expect(error).toBeNull();
    expect(tables).toEqual([]);
  });

  test("maps uuid USER-DEFINED column to uuid kind", async () => {
    const sql = makeSql(
      [["users"]],
      [["id", "uuid", "USER-DEFINED", "NO", null]],
      [["id", "PRIMARY KEY"]],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("uuid");
    expect(col?.unknownDbType).toBeNull();
  });

  test("maps text / varchar / character varying to string kind", async () => {
    const cases: [string, string][] = [
      ["text", "text"],
      ["varchar", "character varying"],
      ["name", "name"],
      ["citext", "citext"],
    ];

    for (const [udtName, dataType] of cases) {
      const sql = makeSql(
        [["t"]],
        [["col", udtName, dataType, "YES", null]],
        [],
        [],
      );

      const [, tables] = await introspectPostgres(sql);
      const col = tables?.[0]?.columns[0];

      expect(col?.kind).toBe("string");
      expect(col?.unknownDbType).toBeNull();
    }
  });

  test("maps integer / bigint / numeric / double precision to number kind", async () => {
    const types = [
      "integer",
      "bigint",
      "smallint",
      "numeric",
      "double precision",
      "real",
    ];

    for (const dataType of types) {
      const sql = makeSql(
        [["t"]],
        [["col", dataType, dataType, "YES", null]],
        [],
        [],
      );

      const [, tables] = await introspectPostgres(sql);

      expect(tables?.[0]?.columns[0]?.kind).toBe("number");
    }
  });

  test("maps boolean / bool to boolean kind", async () => {
    for (const dataType of ["boolean", "bool"]) {
      const sql = makeSql(
        [["t"]],
        [["col", dataType, dataType, "YES", null]],
        [],
        [],
      );

      const [, tables] = await introspectPostgres(sql);

      expect(tables?.[0]?.columns[0]?.kind).toBe("boolean");
    }
  });

  test("maps timestamp / timestamptz / date to date kind", async () => {
    const types = [
      "timestamp without time zone",
      "timestamp with time zone",
      "timestamptz",
      "date",
      "time without time zone",
    ];

    for (const dataType of types) {
      const sql = makeSql(
        [["t"]],
        [["col", dataType, dataType, "YES", null]],
        [],
        [],
      );

      const [, tables] = await introspectPostgres(sql);

      expect(tables?.[0]?.columns[0]?.kind).toBe("date");
    }
  });

  test("maps json to json kind and jsonb to jsonb kind", async () => {
    const sql = makeSql(
      [["t"]],
      [
        ["meta", "json", "json", "YES", null],
        ["data", "jsonb", "jsonb", "YES", null],
      ],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const cols = tables?.[0]?.columns ?? [];

    expect(cols[0]?.kind).toBe("json");
    expect(cols[1]?.kind).toBe("jsonb");
  });

  test("records unknownDbType for unrecognized types", async () => {
    const sql = makeSql(
      [["t"]],
      [["col", "bytea", "bytea", "YES", null]],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("string");
    expect(col?.unknownDbType).toBe("bytea");
  });

  test("detects primaryKey from constraints", async () => {
    const sql = makeSql(
      [["users"]],
      [["id", "uuid", "USER-DEFINED", "NO", null]],
      [["id", "PRIMARY KEY"]],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.primaryKey).toBe(true);
    expect(col?.unique).toBe(false);
  });

  test("detects unique from constraints", async () => {
    const sql = makeSql(
      [["users"]],
      [["email", "text", "text", "NO", null]],
      [["email", "UNIQUE"]],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.primaryKey).toBe(false);
    expect(col?.unique).toBe(true);
  });

  test("detects nullable from is_nullable", async () => {
    const sql = makeSql(
      [["t"]],
      [
        ["required", "text", "text", "NO", null],
        ["optional", "text", "text", "YES", null],
      ],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const cols = tables?.[0]?.columns ?? [];

    expect(cols[0]?.nullable).toBe(false);
    expect(cols[1]?.nullable).toBe(true);
  });

  test("captures rawDefault", async () => {
    const sql = makeSql(
      [["t"]],
      [
        [
          "created_at",
          "timestamp",
          "timestamp without time zone",
          "YES",
          "now()",
        ],
      ],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.rawDefault).toBe("now()");
  });

  test("populates references for foreign key columns", async () => {
    const sql = makeSql(
      [["posts"]],
      [["user_id", "uuid", "USER-DEFINED", "NO", null]],
      [],
      [["user_id", "users", "id", "CASCADE"]],
    );

    const [, tables] = await introspectPostgres(sql);
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
      [["user_id", "uuid", "USER-DEFINED", "NO", null]],
      [],
      [["user_id", "users", "id", "NO ACTION"]],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.references?.onDelete).toBeNull();
  });

  test("handles multiple tables", async () => {
    const sql = makeSql(
      [["posts"], ["users"]],
      // posts columns + constraints + fks
      [["id", "uuid", "USER-DEFINED", "NO", null]],
      [["id", "PRIMARY KEY"]],
      [],
      // users columns + constraints + fks
      [["id", "uuid", "USER-DEFINED", "NO", null]],
      [["id", "PRIMARY KEY"]],
      [],
    );

    const [, tables] = await introspectPostgres(sql);

    expect(tables).toHaveLength(2);
    expect(tables?.[0]?.name).toBe("posts");
    expect(tables?.[1]?.name).toBe("users");
  });

  test("returns error when table query fails", async () => {
    let i = 0;
    const sql = (() => ({
      values: () =>
        i++ === 0
          ? Promise.reject(new Error("connection refused"))
          : Promise.resolve([]),
    })) as unknown as SQL;

    const [error, tables] = await introspectPostgres(sql);

    expect(tables).toBeNull();
    expect(error?.message).toContain("Failed to list tables");
    expect(error?.message).toContain("connection refused");
  });

  test("returns error when column query fails", async () => {
    let i = 0;
    const sql = (() => ({
      values: () => {
        if (i++ === 0) return Promise.resolve([["users"]]);
        return Promise.reject(new Error("permission denied"));
      },
    })) as unknown as SQL;

    const [error] = await introspectPostgres(sql);

    expect(error?.message).toContain("Failed to list columns for users");
  });
});

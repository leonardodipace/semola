import type { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { introspectPostgres } from "./postgres.js";

// Each call to sql`...` in postgres.ts returns an object with .values().
// Order: (1) enums, (2) table list, then per table: (3) columns, (4) constraints, (5) foreign keys.
function makeSql(...results: unknown[][][]): SQL {
  let i = 0;

  const queue = [[], ...results];

  const tag = () => ({ values: () => Promise.resolve(queue[i++] ?? []) });

  return tag as unknown as SQL;
}

function makeSqlWithEnums(
  enumRows: unknown[][],
  ...results: unknown[][][]
): SQL {
  let i = 0;

  const queue = [enumRows, ...results];

  const tag = () => ({ values: () => Promise.resolve(queue[i++] ?? []) });

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

  test("maps ARRAY columns to native scalar kind with array element kind", async () => {
    const sql = makeSql(
      [["organizations"]],
      [["auth_methods", "_auth_method", "ARRAY", "YES", null]],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("string");
    expect(col?.arrayElementKind).toBe("string");
    expect(col?.unknownDbType).toBe("auth_method");
  });

  test("maps enum arrays to string kind with enum values", async () => {
    const sql = makeSqlWithEnums(
      [
        ["auth_method", "basic"],
        ["auth_method", "microsoft"],
      ],
      [["organizations"]],
      [["auth_methods", "_auth_method", "ARRAY", "YES", null]],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("string");
    expect(col?.arrayElementKind).toBe("string");
    expect(col?.enumValues).toEqual(["basic", "microsoft"]);
    expect(col?.unknownDbType).toBeNull();
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
      [["email", "UNIQUE", 1]],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.primaryKey).toBe(false);
    expect(col?.unique).toBe(true);
  });

  test("detects unique from single-column unique index metadata", async () => {
    const sql = makeSql(
      [["users"]],
      [["email", "text", "text", "NO", null]],
      [["email", "UNIQUE", 1]],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.unique).toBe(true);
  });

  test("does not mark columns as unique for composite unique constraints", async () => {
    const sql = makeSql(
      [["users"]],
      [
        ["first_name", "text", "text", "NO", null],
        ["last_name", "text", "text", "NO", null],
      ],
      [
        ["first_name", "UNIQUE", 2],
        ["last_name", "UNIQUE", 2],
      ],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const cols = tables?.[0]?.columns ?? [];

    expect(cols[0]?.unique).toBe(false);
    expect(cols[1]?.unique).toBe(false);
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

  test("uses table-qualified joins for constraints and foreign keys", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const query = strings.join(" ");

      if (query.includes("FROM pg_catalog.pg_type t")) {
        return { values: () => Promise.resolve([]) };
      }

      if (query.includes("FROM information_schema.tables")) {
        return { values: () => Promise.resolve([["posts"]]) };
      }

      if (query.includes("FROM information_schema.columns")) {
        return {
          values: () =>
            Promise.resolve([["user_id", "uuid", "USER-DEFINED", "NO", null]]),
        };
      }

      if (query.includes("tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')")) {
        const hasTableJoin = /tc\.table_name\s*=\s*kcu\.table_name/.test(query);

        if (!hasTableJoin) {
          return {
            values: () => Promise.resolve([["other_table_col", "UNIQUE", 1]]),
          };
        }

        return { values: () => Promise.resolve([["user_id", "UNIQUE", 1]]) };
      }

      if (query.includes("tc.constraint_type = 'FOREIGN KEY'")) {
        const hasTableJoin = /tc\.table_name\s*=\s*kcu\.table_name/.test(query);

        if (!hasTableJoin) {
          return {
            values: () =>
              Promise.resolve([["other_table_fk", "users", "id", "CASCADE"]]),
          };
        }

        return {
          values: () =>
            Promise.resolve([["user_id", "users", "id", "CASCADE"]]),
        };
      }

      return { values: () => Promise.resolve([]) };
    }) as unknown as SQL;

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.unique).toBe(true);
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
        i++ === 1
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
        if (i++ === 0) return Promise.resolve([]);
        if (i === 2) return Promise.resolve([["users"]]);
        return Promise.reject(new Error("permission denied"));
      },
    })) as unknown as SQL;

    const [error] = await introspectPostgres(sql);

    expect(error?.message).toContain("Failed to list columns for users");
  });

  test("maps USER-DEFINED non-uuid enum type to string with enum values", async () => {
    const sql = makeSqlWithEnums(
      [
        ["site_status", "active"],
        ["site_status", "retired"],
      ],
      [["sites"]],
      [
        [
          "status",
          "site_status",
          "USER-DEFINED",
          "NO",
          "'active'::site_status",
        ],
      ],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("string");
    expect(col?.unknownDbType).toBeNull();
    expect(col?.enumValues).toEqual(["active", "retired"]);
    expect(col?.nullable).toBe(false);
    expect(col?.rawDefault).toBe("'active'::site_status");
  });

  test("maps integer array (_int4) to number kind with number arrayElementKind", async () => {
    const sql = makeSql(
      [["tiers"]],
      [["scores", "_int4", "ARRAY", "YES", null]],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("number");
    expect(col?.arrayElementKind).toBe("number");
    expect(col?.unknownDbType).toBeNull();
  });

  test("maps boolean array (_bool) to boolean kind with boolean arrayElementKind", async () => {
    const sql = makeSql(
      [["t"]],
      [["flags", "_bool", "ARRAY", "YES", null]],
      [],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const col = tables?.[0]?.columns[0];

    expect(col?.kind).toBe("boolean");
    expect(col?.arrayElementKind).toBe("boolean");
    expect(col?.unknownDbType).toBeNull();
  });

  test("maps composite primary key columns (join table A/B pattern)", async () => {
    const sql = makeSql(
      [["_RoleToUser"]],
      [
        ["A", "text", "text", "NO", null],
        ["B", "text", "text", "NO", null],
      ],
      [
        ["A", "PRIMARY KEY"],
        ["B", "PRIMARY KEY"],
      ],
      [],
    );

    const [, tables] = await introspectPostgres(sql);
    const cols = tables?.[0]?.columns ?? [];

    expect(cols[0]?.primaryKey).toBe(true);
    expect(cols[1]?.primaryKey).toBe(true);
    expect(cols[0]?.sqlName).toBe("A");
    expect(cols[1]?.sqlName).toBe("B");
  });
});

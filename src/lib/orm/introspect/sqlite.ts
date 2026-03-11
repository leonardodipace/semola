import type { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
import type { ColumnKind } from "../types.js";
import type {
  IntrospectedColumn,
  IntrospectedTable,
  OnDeleteAction,
} from "./types.js";

function mapDbType(dbType: string): {
  kind: ColumnKind;
  unknown: string | null;
} {
  const t = dbType
    .toUpperCase()
    .replace(/\(.*\)/, "")
    .trim();

  if (
    t === "TEXT" ||
    t === "VARCHAR" ||
    t === "CHAR" ||
    t === "CLOB" ||
    t === "BLOB" ||
    t === ""
  ) {
    return { kind: "string", unknown: null };
  }

  if (
    t === "INTEGER" ||
    t === "INT" ||
    t === "TINYINT" ||
    t === "SMALLINT" ||
    t === "MEDIUMINT" ||
    t === "BIGINT" ||
    t === "UNSIGNED BIG INT" ||
    t === "INT2" ||
    t === "INT8" ||
    t === "NUMERIC" ||
    t === "DECIMAL" ||
    t === "REAL" ||
    t === "DOUBLE" ||
    t === "DOUBLE PRECISION" ||
    t === "FLOAT"
  ) {
    return { kind: "number", unknown: null };
  }

  if (t === "BOOLEAN" || t === "BOOL") {
    return { kind: "boolean", unknown: null };
  }

  if (t === "DATE" || t === "DATETIME" || t === "TIMESTAMP") {
    return { kind: "date", unknown: null };
  }

  if (t === "JSON") {
    return { kind: "json", unknown: null };
  }

  return { kind: "string", unknown: dbType };
}

function toOnDelete(action: string): OnDeleteAction | null {
  if (action === "CASCADE") return "CASCADE";
  if (action === "RESTRICT") return "RESTRICT";
  if (action === "SET NULL") return "SET NULL";
  return null;
}

function toErrMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export async function introspectSqlite(sql: SQL) {
  const [tablesErr, tableRows] = await mightThrow(
    sql`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `.values() as Promise<[string][]>,
  );

  if (tablesErr) {
    return err(
      "IntrospectError",
      `Failed to list tables: ${toErrMsg(tablesErr)}`,
    );
  }

  const tableNames = (tableRows ?? []).map((row) => row[0]);
  const tables: IntrospectedTable[] = [];

  for (const tableName of tableNames) {
    const [colErr, colRows] = await mightThrow(
      sql`PRAGMA table_info(${sql.unsafe(tableName)})`.values() as Promise<
        [number, string, string, number, string | null, number][]
      >,
    );

    if (colErr) {
      return err(
        "IntrospectError",
        `Failed to get table_info for ${tableName}: ${toErrMsg(colErr)}`,
      );
    }

    const [fkErr, fkRows] = await mightThrow(
      sql`PRAGMA foreign_key_list(${sql.unsafe(tableName)})`.values() as Promise<
        [number, number, string, string, string, string, string, string][]
      >,
    );

    if (fkErr) {
      return err(
        "IntrospectError",
        `Failed to get foreign_key_list for ${tableName}: ${toErrMsg(fkErr)}`,
      );
    }

    const safeColRows = colRows ?? [];
    const safeFkRows = fkRows ?? [];

    const fkMap = new Map<string, [string, string, string]>();
    for (const [, , refTable, fromCol, toCol, , onDelete] of safeFkRows) {
      fkMap.set(fromCol, [refTable, toCol, onDelete]);
    }

    const columns: IntrospectedColumn[] = safeColRows.map(
      ([, name, type, notnull, dfltValue, pk]) => {
        const { kind, unknown } = mapDbType(type);
        const fk = fkMap.get(name);

        return {
          sqlName: name,
          kind,
          nullable: notnull === 0 && pk === 0,
          primaryKey: pk > 0,
          unique: false,
          rawDefault: dfltValue,
          references: fk
            ? {
                table: fk[0],
                column: fk[1],
                onDelete: toOnDelete(fk[2]),
              }
            : null,
          unknownDbType: unknown,
        };
      },
    );

    tables.push({ name: tableName, columns });
  }

  return ok(tables);
}

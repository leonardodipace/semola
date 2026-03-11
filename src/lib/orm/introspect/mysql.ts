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
    .toLowerCase()
    .replace(/\(.*\)/, "")
    .trim();

  if (
    t === "varchar" ||
    t === "char" ||
    t === "text" ||
    t === "tinytext" ||
    t === "mediumtext" ||
    t === "longtext" ||
    t === "enum" ||
    t === "set"
  ) {
    return { kind: "string", unknown: null };
  }

  if (
    t === "int" ||
    t === "tinyint" ||
    t === "smallint" ||
    t === "mediumint" ||
    t === "bigint" ||
    t === "integer" ||
    t === "decimal" ||
    t === "numeric" ||
    t === "float" ||
    t === "double" ||
    t === "real"
  ) {
    return { kind: "number", unknown: null };
  }

  if (t === "boolean" || t === "bool" || t === "bit") {
    return { kind: "boolean", unknown: null };
  }

  if (
    t === "date" ||
    t === "datetime" ||
    t === "timestamp" ||
    t === "time" ||
    t === "year"
  ) {
    return { kind: "date", unknown: null };
  }

  if (t === "json") {
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

export async function introspectMysql(sql: SQL, schema: string) {
  const [tablesErr, tableRows] = await mightThrow(
    sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schema}
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
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
      sql`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          column_key,
          extra
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND table_name = ${tableName}
        ORDER BY ordinal_position
      `.values() as Promise<
        [string, string, string, string | null, string, string][]
      >,
    );

    if (colErr) {
      return err(
        "IntrospectError",
        `Failed to list columns for ${tableName}: ${toErrMsg(colErr)}`,
      );
    }

    const [fkErr, fkRows] = await mightThrow(
      sql`
        SELECT
          kcu.column_name,
          kcu.referenced_table_name,
          kcu.referenced_column_name,
          rc.delete_rule
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.referential_constraints rc
          ON kcu.constraint_name = rc.constraint_name
          AND kcu.constraint_schema = rc.constraint_schema
        WHERE kcu.table_schema = ${schema}
          AND kcu.table_name = ${tableName}
          AND kcu.referenced_table_name IS NOT NULL
      `.values() as Promise<[string, string, string, string][]>,
    );

    if (fkErr) {
      return err(
        "IntrospectError",
        `Failed to list foreign keys for ${tableName}: ${toErrMsg(fkErr)}`,
      );
    }

    const safeColRows = colRows ?? [];
    const safeFkRows = fkRows ?? [];

    const fkMap = new Map<string, [string, string, string]>();
    for (const [
      columnName,
      referencedTable,
      referencedColumn,
      deleteRule,
    ] of safeFkRows) {
      fkMap.set(columnName, [referencedTable, referencedColumn, deleteRule]);
    }

    const columns: IntrospectedColumn[] = safeColRows.map(
      ([columnName, dataType, isNullable, columnDefault, columnKey]) => {
        const { kind, unknown } = mapDbType(dataType);
        const fk = fkMap.get(columnName);

        return {
          sqlName: columnName,
          kind,
          nullable: isNullable === "YES",
          primaryKey: columnKey === "PRI",
          unique: columnKey === "UNI",
          rawDefault: columnDefault,
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

import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";
import type { ColumnTypeMapping } from "./types.js";

// Shared single-quote escape (SQLite and Postgres use the same rule).
export const escapeStringSingleQuote = (value: string) =>
  value.replace(/'/g, "''");

// Builds the SQL column definition parts shared across all dialects.
// numberPkType is the SQL type for auto-incrementing number PKs (e.g. "BIGSERIAL", "BIGINT AUTO_INCREMENT").
// For SQLite, pass null to use plain "INTEGER PRIMARY KEY".
// uuidFunction is the SQL expression for auto-generating UUIDs (e.g. "gen_random_uuid()"), or null if unsupported.
export const buildColumnDef = (
  column: Column<ColumnKind, ColumnMeta>,
  types: ColumnTypeMapping,
  quoteId: (s: string) => string,
  formatDefault: (kind: ColumnKind, value: unknown) => string,
  numberPkType: string | null,
  uuidFunction: string | null,
) => {
  const parts: string[] = [quoteId(column.sqlName)];

  if (
    column.meta.primaryKey &&
    column.columnKind === "number" &&
    numberPkType
  ) {
    parts.push(`${numberPkType} PRIMARY KEY`);
    return ok(parts.join(" "));
  }

  const sqlType = types[column.columnKind];
  if (!sqlType) {
    return err(
      "UnsupportedType",
      `Unsupported column type: ${column.columnKind}`,
    );
  }
  parts.push(sqlType);

  if (column.meta.primaryKey) parts.push("PRIMARY KEY");
  if (column.meta.notNull && !column.meta.primaryKey) parts.push("NOT NULL");
  if (column.meta.unique && !column.meta.primaryKey) parts.push("UNIQUE");

  if (column.meta.hasDefault && column.defaultValue !== undefined) {
    parts.push(
      `DEFAULT ${formatDefault(column.columnKind, column.defaultValue)}`,
    );
  } else if (
    column.columnKind === "uuid" &&
    column.meta.primaryKey &&
    uuidFunction
  ) {
    parts.push(`DEFAULT ${uuidFunction}`);
  }

  if (column.foreignKeyRef) {
    const ref = column.foreignKeyRef;
    let fk = `REFERENCES ${quoteId(ref.tableName)}(${quoteId(ref.columnName)})`;
    if (column.onDeleteAction)
      fk += ` ON DELETE ${column.onDeleteAction.toUpperCase()}`;
    parts.push(fk);
  }

  return ok(parts.join(" "));
};

// Builds a full CREATE TABLE IF NOT EXISTS statement, shared across all dialects.
export const buildCreateTableSql = (
  table: Table,
  types: ColumnTypeMapping,
  quoteId: (s: string) => string,
  formatDefault: (kind: ColumnKind, value: unknown) => string,
  numberPkType: string | null,
  uuidFunction: string | null,
) => {
  const columnDefs: string[] = [];

  for (const [_key, column] of Object.entries(table.columns)) {
    const [error, def] = buildColumnDef(
      column,
      types,
      quoteId,
      formatDefault,
      numberPkType,
      uuidFunction,
    );
    if (error) return err(error.type, error.message);
    columnDefs.push(def);
  }

  return ok(
    `CREATE TABLE IF NOT EXISTS ${quoteId(table.sqlName)} (${columnDefs.join(", ")})`,
  );
};

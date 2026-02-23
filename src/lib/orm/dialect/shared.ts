import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { ColumnTypeMapping } from "./types.js";

// Builds the SQL column definition parts shared across all dialects.
// numberPkType is the SQL type for auto-incrementing number PKs (e.g. "BIGSERIAL", "BIGINT AUTO_INCREMENT").
// For SQLite, pass null to use plain "INTEGER PRIMARY KEY".
export const buildColumnDef = (
  column: Column<ColumnKind, ColumnMeta>,
  types: ColumnTypeMapping,
  quoteId: (s: string) => string,
  formatDefault: (kind: ColumnKind, value: unknown) => string,
  numberPkType: string | null,
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

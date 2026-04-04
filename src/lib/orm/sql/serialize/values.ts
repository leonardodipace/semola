import type { Table } from "../../table.js";
import type { ColDefs, DialectAdapter } from "../../types.js";

function escapePostgresArrayString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function toPostgresArrayLiteral(value: unknown[]) {
  if (value.length === 0) {
    return "{}";
  }

  const items = value.map((item) => {
    if (item === null || item === undefined) {
      return "NULL";
    }

    if (typeof item === "number") {
      return String(item);
    }

    if (typeof item === "boolean") {
      return item ? "TRUE" : "FALSE";
    }

    if (item instanceof Date) {
      return `"${escapePostgresArrayString(item.toISOString())}"`;
    }

    return `"${escapePostgresArrayString(String(item))}"`;
  });

  return `{${items.join(",")}}`;
}

export function mapDataToSqlRow<T extends ColDefs>(
  table: Table<T>,
  data: Record<string, unknown>,
  dialectAdapter: DialectAdapter,
) {
  const row: Record<string, unknown> = {};

  for (const jsKey in data) {
    const value = data[jsKey];

    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    if (
      dialectAdapter.dialect === "postgres" &&
      col.meta.isSqlArray &&
      Array.isArray(value)
    ) {
      row[col.meta.sqlName] = toPostgresArrayLiteral(value);
      continue;
    }

    row[col.meta.sqlName] = dialectAdapter.serializeValue(col.kind, value);
  }

  return row;
}

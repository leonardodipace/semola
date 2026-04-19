import { parsePostgresArrayLiteral } from "../sql/parse-array.js";
import type { Table } from "../table.js";
import type { ColDefs, Dialect, TableRow } from "../types.js";

function normalizeRecordForTable<T extends ColDefs>(
  table: Table<T>,
  row: Record<string, unknown>,
) {
  let normalized: Record<string, unknown> | null = null;

  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    if (!col.meta.isSqlArray) {
      continue;
    }

    const value = Reflect.get(row, jsKey);

    if (Array.isArray(value)) {
      continue;
    }

    if (typeof value !== "string") {
      continue;
    }

    const parsed = parsePostgresArrayLiteral(value);

    if (!parsed) {
      continue;
    }

    if (!normalized) {
      normalized = { ...row };
    }

    normalized[jsKey] = parsed;
  }

  if (!normalized) {
    return row;
  }

  return normalized;
}

export function normalizeRows<T extends ColDefs>(
  dialect: Dialect,
  table: Table<T>,
  rows: TableRow<T>[],
) {
  if (dialect !== "postgres") {
    return rows;
  }

  return rows.map((row) => normalizeRecordForTable(table, row) as TableRow<T>);
}

export function normalizeRowsForTable(
  dialect: Dialect,
  table: Table<ColDefs>,
  rows: Record<string, unknown>[],
) {
  if (dialect !== "postgres") {
    return rows;
  }

  return rows.map((row) => normalizeRecordForTable(table, row));
}

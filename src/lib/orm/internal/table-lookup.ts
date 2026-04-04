import type { ColumnDef } from "../column.js";
import type { Table } from "../table.js";
import type { ColDefs, ColumnKind, ColumnMetaBase } from "../types.js";

export type ResolvedColumn = {
  jsKey: string;
  col: ColumnDef<ColumnKind, ColumnMetaBase, unknown>;
};

export function getPrimaryKeyColumn(table: Table<ColDefs>) {
  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    if (col.meta.isPrimaryKey) {
      return {
        jsKey,
        col,
      } satisfies ResolvedColumn;
    }
  }

  return null;
}

export function findColumnBySqlName(table: Table<ColDefs>, sqlName: string) {
  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    if (col.meta.sqlName === sqlName) {
      return {
        jsKey,
        col,
      } satisfies ResolvedColumn;
    }
  }

  return null;
}

export function findTableKeyByValue(
  tables: Record<string, Table<ColDefs>>,
  targetTable: Table<ColDefs>,
) {
  for (const tableKey in tables) {
    const table = tables[tableKey];

    if (!table) {
      continue;
    }

    if (table === targetTable) {
      return tableKey;
    }
  }

  return null;
}

import type { ColumnDef } from "../column.js";
import type { Table } from "../table.js";
import type {
  ColDefs,
  ColumnKind,
  ColumnMetaBase,
  RelationDefs,
} from "../types.js";
import { findTableKeyByValue } from "./table-lookup.js";

export function findManyForeignKeyByReference(
  sourceTable: Table<ColDefs>,
  sourcePk: ColumnDef<ColumnKind, ColumnMetaBase, unknown>,
) {
  for (const key in sourceTable.columns) {
    const col = sourceTable.columns[key];

    if (!col) {
      continue;
    }

    if (!col.meta.references) {
      continue;
    }

    const referenced = col.meta.references();

    if (referenced === sourcePk) {
      return col.meta.sqlName;
    }
  }

  return null;
}

export function inferManyForeignKeyFromInverse(
  sourceTable: Table<ColDefs>,
  targetTable: Table<ColDefs>,
  allRelations: Partial<Record<string, RelationDefs>>,
  allTables: Record<string, Table<ColDefs>>,
) {
  const targetTableKey = findTableKeyByValue(allTables, targetTable);

  if (!targetTableKey) {
    return null;
  }

  const targetRels = allRelations[targetTableKey];

  if (!targetRels) {
    return null;
  }

  for (const relKey in targetRels) {
    const rel = targetRels[relKey];

    if (!rel) {
      continue;
    }

    if (rel.kind !== "one") {
      continue;
    }

    if (rel.table() !== sourceTable) {
      continue;
    }

    return rel.foreignKey;
  }

  return null;
}

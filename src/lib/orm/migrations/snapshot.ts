import type { Column } from "../column/types.js";
import type { Table } from "../table/types.js";
import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from "./types.js";

const findReferencedColumn = (
  tables: Record<string, Table>,
  referenced: { sqlName: string },
) => {
  for (const table of Object.values(tables)) {
    for (const column of Object.values(table.columns)) {
      if (column === referenced) {
        return {
          table: table.sqlName,
          column: column.sqlName,
        };
      }
    }
  }

  return undefined;
};

const snapshotColumn = (
  column: Column,
  tables: Record<string, Table>,
): ColumnSnapshot => {
  const snapshot: ColumnSnapshot = {
    name: column.sqlName,
    type: column.type,
    isNullable: column._meta.isNullable,
    isPrimaryKey: column._meta.isPrimaryKey,
    isUnique: column._meta.isUnique,
  };

  if (column.sqlType) {
    snapshot.sqlType = column.sqlType;
  }

  if (column._dbDefault !== undefined) {
    snapshot.dbDefault = column._dbDefault;
  }

  if (column.type === "enum" && column.enumValues) {
    snapshot.enumValues = [...column.enumValues];
  }

  const getReferenced = column.references?.tableColumn;

  if (getReferenced) {
    const referenced = findReferencedColumn(tables, getReferenced());

    if (referenced) {
      snapshot.references = referenced;
    }
  }

  return snapshot;
};

const snapshotTable = (
  table: Table,
  tables: Record<string, Table>,
): TableSnapshot => {
  const columns: Record<string, ColumnSnapshot> = {};

  for (const column of Object.values(table.columns)) {
    columns[column.sqlName] = snapshotColumn(column, tables);
  }

  return {
    name: table.sqlName,
    columns,
  };
};

export const snapshotSchema = (
  tables: Record<string, Table>,
): SchemaSnapshot => {
  const result: Record<string, TableSnapshot> = {};

  for (const table of Object.values(tables)) {
    result[table.sqlName] = snapshotTable(table, tables);
  }

  return { tables: result };
};

export const emptySchema = (): SchemaSnapshot => {
  return { tables: {} };
};

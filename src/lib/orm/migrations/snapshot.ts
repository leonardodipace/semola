import type { Column } from "../column/types.js";
import { MigrationError } from "../errors.js";
import type { Table } from "../table/types.js";
import type { ColumnSnapshot, TableSnapshot } from "./types.js";

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
  tableName: string,
  tables: Record<string, Table>,
) => {
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

  if (column._meta.dbDefault !== undefined) {
    snapshot.dbDefault = column._meta.dbDefault;
  }

  if (column.type === "enum" && column.enumValues) {
    snapshot.enumValues = [...column.enumValues];
  }

  if (column.references?.tableColumn) {
    const referenced = findReferencedColumn(
      tables,
      column.references.tableColumn(),
    );

    if (!referenced) {
      throw new MigrationError(
        `Column ${tableName}.${column.sqlName} references a column that is not in createOrm({ tables })`,
      );
    }

    snapshot.references = referenced;
  }

  return snapshot;
};

const snapshotTable = (table: Table, tables: Record<string, Table>) => {
  const columns: Record<string, ColumnSnapshot> = {};

  for (const column of Object.values(table.columns)) {
    columns[column.sqlName] = snapshotColumn(column, table.sqlName, tables);
  }

  return {
    name: table.sqlName,
    columns,
  };
};

export const snapshotSchema = (tables: Record<string, Table>) => {
  const result: Record<string, TableSnapshot> = {};

  for (const table of Object.values(tables)) {
    result[table.sqlName] = snapshotTable(table, tables);
  }

  return { tables: result };
};

export const emptySchema = () => {
  return { tables: {} };
};

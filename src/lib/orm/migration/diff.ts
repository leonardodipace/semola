import { err, ok } from "../../errors/index.js";
import type {
  ColumnSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from "./snapshot.js";
import type { TableDiffOperation } from "./types.js";

const columnsEqual = (a: ColumnSnapshot, b: ColumnSnapshot): boolean => {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.primaryKey === b.primaryKey &&
    a.notNull === b.notNull &&
    a.unique === b.unique &&
    a.hasDefault === b.hasDefault &&
    JSON.stringify(a.defaultValue) === JSON.stringify(b.defaultValue)
  );
};

const diffTable = (
  tableName: string,
  oldTable: TableSnapshot | undefined,
  newTable: TableSnapshot | undefined,
): TableDiffOperation[] => {
  const operations: TableDiffOperation[] = [];

  // Table was removed
  if (oldTable && !newTable) {
    operations.push({
      type: "dropTable",
      tableName,
      tableSnapshot: oldTable,
    });
    return operations;
  }

  // Table was added
  if (!oldTable && newTable) {
    operations.push({
      type: "createTable",
      tableSnapshot: newTable,
    });
    return operations;
  }

  if (!oldTable || !newTable) {
    return operations;
  }

  // Check for column changes
  const oldColumns = new Set(Object.keys(oldTable.columns));
  const newColumns = new Set(Object.keys(newTable.columns));

  // Added columns
  for (const colName of newColumns) {
    if (!oldColumns.has(colName)) {
      const column = newTable.columns[colName];
      if (column) {
        operations.push({
          type: "addColumn",
          tableName,
          columnSnapshot: column,
        });
      }
    }
  }

  // Removed columns
  for (const colName of oldColumns) {
    if (!newColumns.has(colName)) {
      const column = oldTable.columns[colName];
      if (!column) {
        continue;
      }
      operations.push({
        type: "dropColumn",
        tableName,
        columnName: colName,
        columnSnapshot: column,
      });
    }
  }

  // Modified columns
  for (const colName of newColumns) {
    if (oldColumns.has(colName)) {
      const oldCol = oldTable.columns[colName];
      const newCol = newTable.columns[colName];

      if (oldCol && newCol && !columnsEqual(oldCol, newCol)) {
        operations.push({
          type: "alterColumn",
          tableName,
          columnName: colName,
          oldColumn: oldCol,
          newColumn: newCol,
        });
      }
    }
  }

  return operations;
};

export const diffSnapshots = (
  oldSnapshot: SchemaSnapshot | null,
  newSnapshot: SchemaSnapshot,
): TableDiffOperation[] => {
  const operations: TableDiffOperation[] = [];

  if (!oldSnapshot) {
    // No old snapshot, create all tables
    for (const [_tableName, table] of Object.entries(newSnapshot.tables)) {
      operations.push({
        type: "createTable",
        tableSnapshot: table,
      });
    }
    return operations;
  }

  const oldTables = new Set(Object.keys(oldSnapshot.tables));
  const newTables = new Set(Object.keys(newSnapshot.tables));

  // Find all table names (union of old and new)
  const allTables = new Set([...oldTables, ...newTables]);

  for (const tableName of allTables) {
    const oldTable = oldSnapshot.tables[tableName];
    const newTable = newSnapshot.tables[tableName];
    const tableOps = diffTable(tableName, oldTable, newTable);
    operations.push(...tableOps);
  }

  return operations;
};

// Generate reverse operations for rollback
export const reverseOperations = (operations: TableDiffOperation[]) => {
  const reversed: TableDiffOperation[] = [];

  for (const op of operations) {
    if (op.type === "createTable") {
      reversed.unshift({
        type: "dropTable",
        tableName: op.tableSnapshot.name,
        tableSnapshot: op.tableSnapshot,
      });
    } else if (op.type === "dropTable") {
      if (!op.tableSnapshot) {
        return err("ValidationError", "missing snapshot for reverse");
      }
      reversed.unshift({
        type: "createTable",
        tableSnapshot: op.tableSnapshot,
      });
    } else if (op.type === "addColumn") {
      reversed.unshift({
        type: "dropColumn",
        tableName: op.tableName,
        columnName: op.columnSnapshot.name,
        columnSnapshot: op.columnSnapshot,
      });
    } else if (op.type === "dropColumn") {
      if (!op.columnSnapshot) {
        return err("ValidationError", "missing snapshot for reverse");
      }
      reversed.unshift({
        type: "addColumn",
        tableName: op.tableName,
        columnSnapshot: op.columnSnapshot,
      });
    } else if (op.type === "alterColumn") {
      reversed.unshift({
        type: "alterColumn",
        tableName: op.tableName,
        columnName: op.columnName,
        oldColumn: op.newColumn,
        newColumn: op.oldColumn,
      });
    }
  }

  return ok(reversed);
};

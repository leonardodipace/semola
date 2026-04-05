import { columnsEqual } from "./diff/compare.js";
import {
  orderCreateTableOperations,
  orderDropTableOperations,
  orderRebuildTableOperations,
} from "./diff/order.js";
import type { MigrationOperation, SchemaSnapshot } from "./types.js";

export function diffSnapshots(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
) {
  const dropTableOperations: Array<
    Extract<MigrationOperation, { kind: "drop-table" }>
  > = [];
  const createTableOperations: Array<
    Extract<MigrationOperation, { kind: "create-table" }>
  > = [];
  const dropColumnOperations: Array<
    Extract<MigrationOperation, { kind: "drop-column" }>
  > = [];
  const rebuildTableOperations: Array<
    Extract<MigrationOperation, { kind: "rebuild-table" }>
  > = [];
  const addColumnOperations: Array<
    Extract<MigrationOperation, { kind: "add-column" }>
  > = [];

  for (const [tableKey, oldTable] of Object.entries(previous.tables)) {
    const newTable = current.tables[tableKey];
    if (!newTable) {
      dropTableOperations.push({ kind: "drop-table", table: oldTable });
    }
  }

  for (const [tableKey, newTable] of Object.entries(current.tables)) {
    const oldTable = previous.tables[tableKey];
    if (!oldTable) {
      createTableOperations.push({ kind: "create-table", table: newTable });
      continue;
    }

    const oldBySqlName = new Map(
      Object.values(oldTable.columns).map((c) => [c.sqlName, c]),
    );

    const newBySqlName = new Map(
      Object.values(newTable.columns).map((c) => [c.sqlName, c]),
    );

    let shouldRebuildTable = false;

    const needsSqliteRebuild = current.dialect === "sqlite";

    if (needsSqliteRebuild) {
      for (const sqlName of oldBySqlName.keys()) {
        if (newBySqlName.has(sqlName)) {
          continue;
        }

        shouldRebuildTable = true;
        break;
      }

      if (!shouldRebuildTable) {
        for (const [sqlName, newColumn] of newBySqlName) {
          const oldColumn = oldBySqlName.get(sqlName);

          if (!oldColumn) {
            continue;
          }

          if (!columnsEqual(oldColumn, newColumn)) {
            shouldRebuildTable = true;
            break;
          }
        }
      }

      if (shouldRebuildTable) {
        rebuildTableOperations.push({
          kind: "rebuild-table",
          fromTable: oldTable,
          toTable: newTable,
        });

        continue;
      }
    }

    for (const [sqlName, oldColumn] of oldBySqlName) {
      if (!newBySqlName.has(sqlName)) {
        dropColumnOperations.push({
          kind: "drop-column",
          tableName: newTable.tableName,
          column: oldColumn,
        });
      }
    }

    for (const [sqlName, newColumn] of newBySqlName) {
      const oldColumn = oldBySqlName.get(sqlName);

      if (!oldColumn) {
        addColumnOperations.push({
          kind: "add-column",
          tableName: newTable.tableName,
          column: newColumn,
        });

        continue;
      }

      if (!columnsEqual(oldColumn, newColumn)) {
        dropColumnOperations.push({
          kind: "drop-column",
          tableName: newTable.tableName,
          column: oldColumn,
        });

        addColumnOperations.push({
          kind: "add-column",
          tableName: newTable.tableName,
          column: newColumn,
        });
      }
    }
  }

  return [
    ...orderRebuildTableOperations(rebuildTableOperations),
    ...dropColumnOperations,
    ...orderDropTableOperations(dropTableOperations),
    ...orderCreateTableOperations(createTableOperations),
    ...addColumnOperations,
  ];
}

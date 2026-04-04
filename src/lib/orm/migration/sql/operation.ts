import type { MigrationOperation, SchemaSnapshot } from "../types.js";
import {
  addColumnSql,
  createTableSql,
  dropColumnSql,
  dropTableSql,
  rebuildTableSql,
} from "./table.js";

export function reverseOperation(operation: MigrationOperation) {
  if (operation.kind === "create-table") {
    return { kind: "drop-table", table: operation.table } as const;
  }

  if (operation.kind === "drop-table") {
    return { kind: "create-table", table: operation.table } as const;
  }

  if (operation.kind === "add-column") {
    return {
      kind: "drop-column",
      tableName: operation.tableName,
      column: operation.column,
    } as const;
  }

  if (operation.kind === "rebuild-table") {
    return {
      kind: "rebuild-table",
      fromTable: operation.toTable,
      toTable: operation.fromTable,
    } as const;
  }

  return {
    kind: "add-column",
    tableName: operation.tableName,
    column: operation.column,
  } as const;
}

export function operationToStatements(
  dialect: SchemaSnapshot["dialect"],
  operation: MigrationOperation,
) {
  if (operation.kind === "create-table") {
    return [createTableSql(dialect, operation.table)];
  }

  if (operation.kind === "drop-table") {
    return [dropTableSql(dialect, operation.table)];
  }

  if (operation.kind === "add-column") {
    return [addColumnSql(dialect, operation.tableName, operation.column)];
  }

  if (operation.kind === "rebuild-table") {
    return rebuildTableSql(dialect, operation.fromTable, operation.toTable);
  }

  return [dropColumnSql(dialect, operation.tableName, operation.column)];
}

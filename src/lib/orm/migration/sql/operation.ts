import type { MigrationOperation, SchemaSnapshot } from "../types.js";
import {
  addColumnSql,
  createTableSql,
  dropColumnSql,
  dropTableSql,
  rebuildTableSql,
} from "./table.js";

export function reverseOperation(
  operation: MigrationOperation,
): MigrationOperation {
  switch (operation.kind) {
    case "create-table":
      return { kind: "drop-table", table: operation.table };

    case "drop-table":
      return { kind: "create-table", table: operation.table };

    case "add-column":
      return {
        kind: "drop-column",
        tableName: operation.tableName,
        column: operation.column,
      };

    case "drop-column":
      return {
        kind: "add-column",
        tableName: operation.tableName,
        column: operation.column,
      };

    case "rebuild-table":
      return {
        kind: "rebuild-table",
        fromTable: operation.toTable,
        toTable: operation.fromTable,
      };
  }
}

export function operationToStatements(
  dialect: SchemaSnapshot["dialect"],
  operation: MigrationOperation,
) {
  switch (operation.kind) {
    case "create-table":
      return [createTableSql(dialect, operation.table)];

    case "drop-table":
      return [dropTableSql(dialect, operation.table)];

    case "add-column":
      return [addColumnSql(dialect, operation.tableName, operation.column)];

    case "drop-column":
      return [dropColumnSql(dialect, operation.tableName, operation.column)];

    case "rebuild-table":
      return rebuildTableSql(dialect, operation.fromTable, operation.toTable);
  }
}

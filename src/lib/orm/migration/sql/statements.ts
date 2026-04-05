import { defaultsEqual } from "../diff/compare.js";
import type {
  ColumnSnapshot,
  MigrationOperation,
  SchemaSnapshot,
} from "../types.js";
import { operationToStatements } from "./operation.js";
import {
  dropColumnNotNullSql,
  renameColumnSql,
  setColumnNotNullSql,
} from "./table.js";

export function joinStatements(statements: string[]) {
  if (statements.length === 0) {
    return "";
  }

  return `${statements.join(";\n")};\n`;
}

export function buildStatements(
  dialect: SchemaSnapshot["dialect"],
  operations: MigrationOperation[],
) {
  if (dialect !== "postgres") {
    return operations.flatMap((operation) =>
      operationToStatements(dialect, operation),
    );
  }

  let didOptimize = false;
  const statements: string[] = [];

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];

    if (!operation) {
      continue;
    }

    const nextOperation = operations[index + 1];
    const optimizedStatement = maybeOptimizePostgresColumnChange(
      operation,
      nextOperation,
      dialect,
    );

    if (optimizedStatement) {
      statements.push(optimizedStatement);
      didOptimize = true;
      index++;
      continue;
    }

    statements.push(...operationToStatements(dialect, operation));
  }

  if (!didOptimize) {
    return statements;
  }

  return ["BEGIN", ...statements, "COMMIT"];
}

export function wrapSqliteRebuildStatements(
  dialect: SchemaSnapshot["dialect"],
  operations: MigrationOperation[],
  statements: string[],
) {
  const hasRebuildOperation = operations.some(
    (operation) => operation.kind === "rebuild-table",
  );

  if (dialect !== "sqlite") {
    return statements;
  }

  if (!hasRebuildOperation) {
    return statements;
  }

  return [
    "PRAGMA foreign_keys = OFF",
    "BEGIN",
    ...statements,
    "COMMIT",
    "PRAGMA foreign_keys = ON",
  ];
}

function maybeOptimizePostgresColumnChange(
  operation: MigrationOperation,
  nextOperation: MigrationOperation | undefined,
  dialect: SchemaSnapshot["dialect"],
) {
  if (operation.kind !== "drop-column") {
    return null;
  }

  if (!nextOperation) {
    return null;
  }

  if (nextOperation.kind !== "add-column") {
    return null;
  }

  if (operation.tableName !== nextOperation.tableName) {
    return null;
  }

  const oldColumn = operation.column;
  const newColumn = nextOperation.column;

  if (isRenameOnlyChange(oldColumn, newColumn)) {
    return renameColumnSql(
      dialect,
      operation.tableName,
      oldColumn.sqlName,
      newColumn.sqlName,
    );
  }

  if (isOnlyNotNullChange(oldColumn, newColumn)) {
    if (!oldColumn.isNotNull && newColumn.isNotNull) {
      return setColumnNotNullSql(
        dialect,
        operation.tableName,
        oldColumn.sqlName,
      );
    }

    if (oldColumn.isNotNull && !newColumn.isNotNull) {
      return dropColumnNotNullSql(
        dialect,
        operation.tableName,
        oldColumn.sqlName,
      );
    }
  }

  return null;
}

function isRenameOnlyChange(
  oldColumn: ColumnSnapshot,
  newColumn: ColumnSnapshot,
) {
  if (oldColumn.sqlName === newColumn.sqlName) {
    return false;
  }

  return hasSameColumnTraits(oldColumn, newColumn);
}

function isOnlyNotNullChange(
  oldColumn: ColumnSnapshot,
  newColumn: ColumnSnapshot,
) {
  if (oldColumn.sqlName !== newColumn.sqlName) {
    return false;
  }

  if (oldColumn.isNotNull === newColumn.isNotNull) {
    return false;
  }

  return hasSameColumnTraits(oldColumn, newColumn, { ignoreNotNull: true });
}

function hasSameColumnTraits(
  oldColumn: ColumnSnapshot,
  newColumn: ColumnSnapshot,
  options?: { ignoreNotNull?: boolean },
) {
  if (oldColumn.kind !== newColumn.kind) return false;
  if (oldColumn.isPrimaryKey !== newColumn.isPrimaryKey) return false;
  if (!options?.ignoreNotNull) {
    if (oldColumn.isNotNull !== newColumn.isNotNull) return false;
  }
  if (oldColumn.isUnique !== newColumn.isUnique) return false;
  if (oldColumn.hasDefault !== newColumn.hasDefault) return false;
  if (!defaultsEqual(oldColumn, newColumn)) return false;
  if (oldColumn.referencesTable !== newColumn.referencesTable) return false;
  if (oldColumn.referencesColumn !== newColumn.referencesColumn) return false;
  if (oldColumn.onDeleteAction !== newColumn.onDeleteAction) return false;
  return true;
}

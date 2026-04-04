import type { MigrationOperation, SchemaSnapshot } from "../types.js";
import { operationToStatements } from "./operation.js";

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
  return operations.flatMap((operation) =>
    operationToStatements(dialect, operation),
  );
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

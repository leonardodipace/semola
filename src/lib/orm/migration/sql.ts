import { reverseOperation } from "./sql/operation.js";
import {
  buildStatements,
  joinStatements,
  wrapSqliteRebuildStatements,
} from "./sql/statements.js";
import type { MigrationOperation, SchemaSnapshot } from "./types.js";

export function buildUpSql(
  dialect: SchemaSnapshot["dialect"],
  operations: MigrationOperation[],
) {
  const statements = buildStatements(dialect, operations);
  const wrappedStatements = wrapSqliteRebuildStatements(
    dialect,
    operations,
    statements,
  );

  return joinStatements(wrappedStatements);
}

export function buildDownSql(
  dialect: SchemaSnapshot["dialect"],
  operations: MigrationOperation[],
) {
  const reversed = [...operations]
    .reverse()
    .map((operation) => reverseOperation(operation));
  const statements = buildStatements(dialect, reversed);
  const wrappedStatements = wrapSqliteRebuildStatements(
    dialect,
    reversed,
    statements,
  );

  return joinStatements(wrappedStatements);
}

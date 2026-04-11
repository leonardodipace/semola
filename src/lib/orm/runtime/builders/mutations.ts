import type { SQL, TransactionSQL } from "bun";
import { buildReturningColumns } from "../../internal/table.js";
import { mapDataToSqlRow, serializeWhereInput } from "../../sql/serialize.js";
import type { Table } from "../../table.js";
import type {
  ColDefs,
  DeleteBuilderInput,
  DialectAdapter,
  InsertInput,
  TableRow,
  UpdateBuilderInput,
} from "../../types.js";

export function createInsertQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: InsertInput<T> & { returning: true },
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
): SQL.Query<TableRow<T>[]>;

export function createInsertQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: InsertInput<T>,
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
): SQL.Query<unknown>;

export function createInsertQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: InsertInput<T>,
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
) {
  const row = mapDataToSqlRow(
    table,
    input.data as Record<string, unknown>,
    dialectAdapter,
  );

  if (supportsReturning && input.returning === true) {
    return sql`INSERT INTO ${sql(table.tableName)} ${sql(row)} RETURNING ${buildReturningColumns(sql, table)}`;
  }

  return sql`INSERT INTO ${sql(table.tableName)} ${sql(row)}`;
}

export function createInsertManyQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  rows: Array<Record<string, unknown>>,
  supportsReturning: true,
): SQL.Query<TableRow<T>[]>;

export function createInsertManyQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  rows: Array<Record<string, unknown>>,
  supportsReturning: boolean,
): SQL.Query<unknown>;

export function createInsertManyQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  rows: Array<Record<string, unknown>>,
  supportsReturning: boolean,
) {
  if (supportsReturning) {
    return sql`INSERT INTO ${sql(table.tableName)} ${sql(rows)} RETURNING ${buildReturningColumns(sql, table)}`;
  }

  return sql`INSERT INTO ${sql(table.tableName)} ${sql(rows)}`;
}

export function createUpdateQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: UpdateBuilderInput<T> & { returning: true },
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
): SQL.Query<TableRow<T>[]>;

export function createUpdateQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: UpdateBuilderInput<T>,
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
): SQL.Query<unknown>;

export function createUpdateQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: UpdateBuilderInput<T>,
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
) {
  const where = serializeWhereInput(sql, table, input.where, dialectAdapter);
  const row = mapDataToSqlRow(
    table,
    input.data as Record<string, unknown>,
    dialectAdapter,
  );

  if (supportsReturning && input.returning === true) {
    return sql`UPDATE ${sql(table.tableName)} SET ${sql(row)} ${where} RETURNING ${buildReturningColumns(sql, table)}`;
  }

  return sql`UPDATE ${sql(table.tableName)} SET ${sql(row)} ${where}`;
}

export function createDeleteQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: DeleteBuilderInput<T> & { returning: true },
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
): SQL.Query<TableRow<T>[]>;

export function createDeleteQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: DeleteBuilderInput<T>,
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
): SQL.Query<unknown>;

export function createDeleteQuery<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  input: DeleteBuilderInput<T>,
  dialectAdapter: DialectAdapter,
  supportsReturning: boolean,
) {
  const where = serializeWhereInput(sql, table, input.where, dialectAdapter);

  if (supportsReturning && input.returning === true) {
    return sql`DELETE FROM ${sql(table.tableName)} ${where} RETURNING ${buildReturningColumns(sql, table)}`;
  }

  return sql`DELETE FROM ${sql(table.tableName)} ${where}`;
}

import type { SQL, TransactionSQL } from "bun";
import { mapDataToSqlRow } from "../sql/serialize.js";
import type { Table } from "../table.js";
import type {
  ColDefs,
  DeleteBuilderInput,
  DialectAdapter,
  InsertInput,
  RelationDefs,
  TableRow,
  UpdateBuilderInput,
} from "../types.js";
import {
  createDeleteQuery,
  createInsertManyQuery,
  createInsertQuery,
  createSelectQuery,
  createUpdateQuery,
} from "./builders.js";
import type { RuntimeDialectContext } from "./dialect/types.js";

export function createRuntimeDialectContext<
  T extends ColDefs,
  TRels extends RelationDefs,
>(options: {
  runner: SQL | TransactionSQL;
  table: Table<T>;
  relations: TRels;
  dialectAdapter: DialectAdapter;
  supportsReturning: boolean;
  normalizeCurrentRows: (rows: TableRow<T>[]) => TableRow<T>[];
  executeOrThrow: <TValue>(promise: Promise<TValue>) => Promise<TValue>;
}) {
  const {
    runner,
    table,
    relations,
    dialectAdapter,
    supportsReturning,
    normalizeCurrentRows,
    executeOrThrow,
  } = options;

  const withRunner = (nextRunner: SQL | TransactionSQL) =>
    createRuntimeDialectContext({
      runner: nextRunner,
      table,
      relations,
      dialectAdapter,
      supportsReturning,
      normalizeCurrentRows,
      executeOrThrow,
    });

  const select = (input = {}) =>
    createSelectQuery(runner, table, relations, input, dialectAdapter);

  const insert = (input: InsertInput<T>) =>
    createInsertQuery(runner, table, input, dialectAdapter, supportsReturning);

  const insertReturning = (input: InsertInput<T> & { returning: true }) =>
    createInsertQuery(runner, table, input, dialectAdapter, supportsReturning);

  const insertMany = (
    rows: Array<Record<string, unknown>>,
    returning: boolean,
  ) =>
    createInsertManyQuery(runner, table, rows, supportsReturning && returning);

  const insertManyReturning = (rows: Array<Record<string, unknown>>) =>
    createInsertManyQuery(runner, table, rows, true);

  const update = (input: UpdateBuilderInput<T>) =>
    createUpdateQuery(runner, table, input, dialectAdapter, supportsReturning);

  const updateReturning = (
    input: UpdateBuilderInput<T> & { returning: true },
  ) =>
    createUpdateQuery(runner, table, input, dialectAdapter, supportsReturning);

  const deleteByWhere = (input: DeleteBuilderInput<T>) =>
    createDeleteQuery(runner, table, input, dialectAdapter, supportsReturning);

  const deleteReturning = (
    input: DeleteBuilderInput<T> & { returning: true },
  ) =>
    createDeleteQuery(runner, table, input, dialectAdapter, supportsReturning);

  const selectRows = async (input = {}) => {
    const rows = await executeOrThrow(select(input));
    return normalizeCurrentRows(rows);
  };

  const context: RuntimeDialectContext<T, TRels> = {
    runner,
    table,
    relations,
    select,
    selectRows,
    insert,
    insertReturning,
    insertMany,
    insertManyReturning,
    update,
    updateReturning,
    deleteByWhere,
    deleteReturning,
    mapSqlRow: (data) => mapDataToSqlRow(table, data, dialectAdapter),
    normalizeResultRows: normalizeCurrentRows,
    executeOrThrow,
    withRunner,
  };

  return context;
}

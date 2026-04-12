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

  function insert(
    input: InsertInput<T> & { returning: true },
  ): SQL.Query<TableRow<T>[]>;
  function insert(input: InsertInput<T>): SQL.Query<unknown>;
  function insert(input: InsertInput<T>) {
    return createInsertQuery(
      runner,
      table,
      input,
      dialectAdapter,
      supportsReturning,
    );
  }

  function insertMany(
    rows: Array<Record<string, unknown>>,
    options: { returning: true },
  ): SQL.Query<TableRow<T>[]>;
  function insertMany(
    rows: Array<Record<string, unknown>>,
    options: { returning: boolean },
  ): SQL.Query<unknown>;
  function insertMany(
    rows: Array<Record<string, unknown>>,
    options: { returning: boolean },
  ) {
    return createInsertManyQuery(
      runner,
      table,
      rows,
      supportsReturning && options.returning,
    );
  }

  function update(
    input: UpdateBuilderInput<T> & { returning: true },
  ): SQL.Query<TableRow<T>[]>;
  function update(input: UpdateBuilderInput<T>): SQL.Query<unknown>;
  function update(input: UpdateBuilderInput<T>) {
    return createUpdateQuery(
      runner,
      table,
      input,
      dialectAdapter,
      supportsReturning,
    );
  }

  function deleteByWhere(
    input: DeleteBuilderInput<T> & { returning: true },
  ): SQL.Query<TableRow<T>[]>;
  function deleteByWhere(input: DeleteBuilderInput<T>): SQL.Query<unknown>;
  function deleteByWhere(input: DeleteBuilderInput<T>) {
    return createDeleteQuery(
      runner,
      table,
      input,
      dialectAdapter,
      supportsReturning,
    );
  }

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
    insertMany,
    update,
    deleteByWhere,
    mapSqlRow: (data) => mapDataToSqlRow(table, data, dialectAdapter),
    normalizeResultRows: normalizeCurrentRows,
    executeOrThrow,
    withRunner,
  };

  return context;
}

import type { SQL, TransactionSQL } from "bun";
import { mapDataToSqlRow } from "../../sql/serialize.js";
import type { Table } from "../../table.js";
import type {
  ColDefs,
  CreateInput,
  CreateManyInput,
  DeleteBuilderInput,
  DeleteManyInput,
  DialectAdapter,
  InsertInput,
  RelationDefs,
  SelectInput,
  TableRow,
  UpdateBuilderInput,
  UpdateManyInput,
} from "../../types.js";
import {
  createDeleteQuery,
  createInsertManyQuery,
  createInsertQuery,
  createSelectQuery,
  createUpdateQuery,
} from "../builders.js";

export type DialectOptions<T extends ColDefs, TRels extends RelationDefs> = {
  sql: SQL | TransactionSQL;
  table: Table<T>;
  relations: TRels;
  dialectAdapter: DialectAdapter;
  supportsReturning: boolean;
  normalizeCurrentRows: (rows: TableRow<T>[]) => TableRow<T>[];
  executeOrThrow: <TValue>(promise: Promise<TValue>) => Promise<TValue>;
};

export abstract class BaseDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
> {
  protected readonly table: Table<T>;
  protected readonly relations: TRels;
  protected readonly normalizeResultRows: (
    rows: TableRow<T>[],
  ) => TableRow<T>[];
  protected readonly executeOrThrow: <TValue>(
    promise: Promise<TValue>,
  ) => Promise<TValue>;

  public readonly select: (
    input?: SelectInput<T, TRels>,
  ) => SQL.Query<TableRow<T>[]>;
  public readonly selectRows: (
    input?: SelectInput<T, TRels>,
  ) => Promise<TableRow<T>[]>;
  public readonly mapSqlRow: (
    data: Record<string, unknown>,
  ) => Record<string, unknown>;

  public readonly insert: {
    (input: InsertInput<T> & { returning: true }): SQL.Query<TableRow<T>[]>;
    (input: InsertInput<T>): SQL.Query<unknown>;
  };

  public readonly insertMany: {
    (
      rows: Array<Record<string, unknown>>,
      options: { returning: true },
    ): SQL.Query<TableRow<T>[]>;
    (
      rows: Array<Record<string, unknown>>,
      options: { returning: boolean },
    ): SQL.Query<unknown>;
  };

  public readonly update: {
    (
      input: UpdateBuilderInput<T> & { returning: true },
    ): SQL.Query<TableRow<T>[]>;
    (input: UpdateBuilderInput<T>): SQL.Query<unknown>;
  };

  public readonly deleteByWhere: {
    (
      input: DeleteBuilderInput<T> & { returning: true },
    ): SQL.Query<TableRow<T>[]>;
    (input: DeleteBuilderInput<T>): SQL.Query<unknown>;
  };

  public constructor(options: DialectOptions<T, TRels>) {
    const {
      sql,
      table,
      relations,
      dialectAdapter,
      supportsReturning,
      normalizeCurrentRows,
      executeOrThrow,
    } = options;

    this.table = table;
    this.relations = relations;
    this.normalizeResultRows = normalizeCurrentRows;
    this.executeOrThrow = executeOrThrow;

    this.select = (input = {}) =>
      createSelectQuery(sql, table, relations, input, dialectAdapter);

    this.mapSqlRow = (data) => mapDataToSqlRow(table, data, dialectAdapter);

    this.selectRows = async (input = {}) => {
      const rows = await executeOrThrow(this.select(input));
      return normalizeCurrentRows(rows);
    };

    function insert(
      input: InsertInput<T> & { returning: true },
    ): SQL.Query<TableRow<T>[]>;
    function insert(input: InsertInput<T>): SQL.Query<unknown>;
    function insert(input: InsertInput<T>) {
      return createInsertQuery(
        sql,
        table,
        input,
        dialectAdapter,
        supportsReturning,
      );
    }
    this.insert = insert;

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
        sql,
        table,
        rows,
        supportsReturning && options.returning,
      );
    }
    this.insertMany = insertMany;

    function update(
      input: UpdateBuilderInput<T> & { returning: true },
    ): SQL.Query<TableRow<T>[]>;
    function update(input: UpdateBuilderInput<T>): SQL.Query<unknown>;
    function update(input: UpdateBuilderInput<T>) {
      return createUpdateQuery(
        sql,
        table,
        input,
        dialectAdapter,
        supportsReturning,
      );
    }
    this.update = update;

    function deleteByWhere(
      input: DeleteBuilderInput<T> & { returning: true },
    ): SQL.Query<TableRow<T>[]>;
    function deleteByWhere(input: DeleteBuilderInput<T>): SQL.Query<unknown>;
    function deleteByWhere(input: DeleteBuilderInput<T>) {
      return createDeleteQuery(
        sql,
        table,
        input,
        dialectAdapter,
        supportsReturning,
      );
    }
    this.deleteByWhere = deleteByWhere;
  }

  public abstract create(input: CreateInput<T>): Promise<TableRow<T>>;
  public abstract createMany(
    input: CreateManyInput<T>,
  ): Promise<{ count: number; rows: TableRow<T>[] }>;
  public abstract updateMany(
    input: UpdateManyInput<T>,
  ): Promise<{ count: number; rows: TableRow<T>[] }>;
  public abstract deleteMany(
    input: DeleteManyInput<T>,
  ): Promise<{ count: number; rows: TableRow<T>[] }>;
}

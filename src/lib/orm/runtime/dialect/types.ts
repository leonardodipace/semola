import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../../table.js";
import type {
  ColDefs,
  CreateInput,
  CreateManyInput,
  DeleteBuilderInput,
  DeleteManyInput,
  InsertInput,
  RelationDefs,
  SelectInput,
  TableRow,
  UpdateBuilderInput,
  UpdateManyInput,
} from "../../types.js";

export type RuntimeDialectContext<
  T extends ColDefs,
  TRels extends RelationDefs,
> = {
  runner: SQL | TransactionSQL;
  table: Table<T>;
  relations: TRels;
  select: (input?: SelectInput<T, TRels>) => SQL.Query<TableRow<T>[]>;
  selectRows: (input?: SelectInput<T, TRels>) => Promise<TableRow<T>[]>;
  insert: (input: InsertInput<T>) => SQL.Query<unknown>;
  insertReturning: (
    input: InsertInput<T> & { returning: true },
  ) => SQL.Query<TableRow<T>[]>;
  insertMany: (
    rows: Array<Record<string, unknown>>,
    returning: boolean,
  ) => SQL.Query<unknown>;
  insertManyReturning: (
    rows: Array<Record<string, unknown>>,
  ) => SQL.Query<TableRow<T>[]>;
  update: (input: UpdateBuilderInput<T>) => SQL.Query<unknown>;
  updateReturning: (
    input: UpdateBuilderInput<T> & { returning: true },
  ) => SQL.Query<TableRow<T>[]>;
  deleteByWhere: (input: DeleteBuilderInput<T>) => SQL.Query<unknown>;
  deleteReturning: (
    input: DeleteBuilderInput<T> & { returning: true },
  ) => SQL.Query<TableRow<T>[]>;
  mapSqlRow: (data: Record<string, unknown>) => Record<string, unknown>;
  normalizeResultRows: (rows: TableRow<T>[]) => TableRow<T>[];
  executeOrThrow: <TValue>(promise: Promise<TValue>) => Promise<TValue>;
  withRunner: (runner: SQL | TransactionSQL) => RuntimeDialectContext<T, TRels>;
};

export type RuntimeDialect<T extends ColDefs, TRels extends RelationDefs> = {
  create: (
    context: RuntimeDialectContext<T, TRels>,
    input: CreateInput<T>,
  ) => Promise<TableRow<T>>;
  createMany: (
    context: RuntimeDialectContext<T, TRels>,
    input: CreateManyInput<T>,
  ) => Promise<{ count: number; rows: TableRow<T>[] }>;
  updateMany: (
    context: RuntimeDialectContext<T, TRels>,
    input: UpdateManyInput<T>,
  ) => Promise<{ count: number; rows: TableRow<T>[] }>;
  deleteMany: (
    context: RuntimeDialectContext<T, TRels>,
    input: DeleteManyInput<T>,
  ) => Promise<{ count: number; rows: TableRow<T>[] }>;
};

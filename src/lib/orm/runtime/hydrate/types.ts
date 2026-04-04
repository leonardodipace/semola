import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../../table.js";
import type { ColDefs, RelationDefs } from "../../types.js";

export type HydratorContext<T extends ColDefs, TRels extends RelationDefs> = {
  sql: SQL | TransactionSQL;
  table: Table<T>;
  relations: TRels;
  allTables: Record<string, Table<ColDefs>>;
  allRelations: Partial<Record<string, RelationDefs>>;
  normalizeRowsForTable: (
    targetTable: Table<ColDefs>,
    rows: Record<string, unknown>[],
  ) => Record<string, unknown>[];
  executeOrThrow: <TValue>(promise: Promise<TValue>) => Promise<TValue>;
};

export type SelectWhereIn = (
  targetTable: Table<ColDefs>,
  sqlColumnName: string,
  values: unknown[],
) => Promise<Record<string, unknown>[]>;

import type { Column, ColumnRuntimeValueMap } from "../column/types.js";
import type { Adapter } from "../dialect/index.js";
import type { Table } from "../table/types.js";

type Prettify<T> = {
  [TKey in keyof T]: T[TKey];
} & {};

export type CreateOrmOptions<T extends Record<string, Table>> = {
  adapter: Adapter;
  url: string;
  tables: T;
};

export type OrmClient<T extends Record<string, Table>> = {
  [TTableName in keyof T]: TableClient<T[TTableName]>;
} & {
  $raw: Bun.SQL;
};

type ColumnRuntimeValue<T extends Column["type"]> = ColumnRuntimeValueMap[T];

type ColumnValue<T extends Column> = T["_meta"]["isNullable"] extends false
  ? ColumnRuntimeValue<T["type"]>
  : ColumnRuntimeValue<T["type"]> | null;

export type TableRow<T extends Table> = Prettify<{
  [TColumnName in keyof T["columns"]]: ColumnValue<T["columns"][TColumnName]>;
}>;

export type TableClient<T extends Table> = {
  findMany: () => Promise<Array<TableRow<T>>>;
};

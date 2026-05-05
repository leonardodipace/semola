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

type NonNullableColumnValue<T extends Column> = Exclude<ColumnValue<T>, null>;

type StringWhereOperators<T extends Column> = {
  eq?: ColumnValue<T>;
  startsWith?: NonNullableColumnValue<T>;
  endsWith?: NonNullableColumnValue<T>;
  contains?: NonNullableColumnValue<T>;
};

type NumberWhereOperators<T extends Column> = {
  eq?: ColumnValue<T>;
  gt?: NonNullableColumnValue<T>;
  gte?: NonNullableColumnValue<T>;
  lt?: NonNullableColumnValue<T>;
  lte?: NonNullableColumnValue<T>;
};

type BooleanWhereOperators<T extends Column> = {
  eq?: ColumnValue<T>;
};

type DateWhereOperators<T extends Column> = {
  eq?: ColumnValue<T>;
  gt?: NonNullableColumnValue<T>;
  gte?: NonNullableColumnValue<T>;
  lt?: NonNullableColumnValue<T>;
  lte?: NonNullableColumnValue<T>;
};

type ColumnWhereOperatorsMap<T extends Column> = {
  string: StringWhereOperators<T>;
  number: NumberWhereOperators<T>;
  boolean: BooleanWhereOperators<T>;
  date: DateWhereOperators<T>;
};

type ColumnWhereOperators<T extends Column> =
  ColumnWhereOperatorsMap<T>[T["type"]];

type ColumnWhere<T extends Column> = ColumnValue<T> | ColumnWhereOperators<T>;

export type TableWhere<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: ColumnWhere<T["columns"][TColumnName]>;
};

export type TableSelect<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: true;
};

export type FindManyOptions<T extends Table> = {
  where?: TableWhere<T>;
  select?: TableSelect<T>;
};

export type TableRow<T extends Table> = Prettify<{
  [TColumnName in keyof T["columns"]]: ColumnValue<T["columns"][TColumnName]>;
}>;

export type FindManyResult<
  T extends Table,
  TOptions extends FindManyOptions<T>,
> = TOptions["select"] extends TableSelect<T>
  ? Prettify<{
      [K in keyof NonNullable<TOptions["select"]> &
        keyof T["columns"]]: ColumnValue<T["columns"][K]>;
    }>
  : TableRow<T>;

export type TableClient<T extends Table> = {
  findMany<const TOptions extends FindManyOptions<T>>(
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TOptions>>>;
};

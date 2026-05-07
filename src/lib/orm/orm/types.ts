import type { Column, ColumnRuntimeValueMap } from "../column/types.js";
import type { Adapter } from "../dialect/index.js";
import type { Table } from "../table/types.js";

export type HasMany<T extends Table> = {
  _type: "hasMany";
  _table: T;
};

export type HasOne<T extends Table> = {
  _type: "hasOne";
  _table: T;
};

export type TableRelations = Record<string, HasMany<Table> | HasOne<Table>>;

export type Relations = Record<string, TableRelations>;

type Prettify<T> = {
  [TKey in keyof T]: T[TKey];
} & {};

export type CreateOrmOptions<
  T extends Record<string, Table> = Record<string, Table>,
  R extends Relations = Relations,
> = {
  adapter: Adapter;
  url: string;
  tables: T;
  relations?: R;
};

export type OrmClient<
  T extends Record<string, Table> = Record<string, Table>,
  R extends Relations = Relations,
> = {
  [TTableName in keyof T]: TableClient<
    T[TTableName],
    TableRelationsFor<R, TTableName>
  >;
} & {
  $raw: Bun.SQL;
};

type TableRelationsFor<
  TRelations extends Relations,
  TTableName extends PropertyKey,
> = TTableName extends keyof TRelations
  ? TRelations[TTableName]
  : Record<never, never>;

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

export type TableOrderBy<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: "asc" | "desc";
};

export type FindManyOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  where?: TableWhere<T>;
  select?: TableSelect<T>;
  orderBy?: TableOrderBy<T>;
  include?: Partial<Record<keyof TRelations, boolean>>;
};

export type TableRow<T extends Table> = Prettify<{
  [TColumnName in keyof T["columns"]]: ColumnValue<T["columns"][TColumnName]>;
}>;

type HasManyRelationResult<R extends HasMany<Table> | HasOne<Table>> =
  Extract<R, HasMany<Table>> extends HasMany<infer T>
    ? Array<TableRow<T>>
    : never;

type HasOneRelationResult<R extends HasMany<Table> | HasOne<Table>> =
  Extract<R, HasOne<Table>> extends HasOne<infer T>
    ? TableRow<T> | null
    : never;

type RelationType<R extends HasMany<Table> | HasOne<Table>> =
  | HasManyRelationResult<R>
  | HasOneRelationResult<R>;

type SelectResult<
  T extends Table,
  TOptions extends FindManyOptions<T>,
> = TOptions["select"] extends TableSelect<T>
  ? {
      [K in keyof NonNullable<TOptions["select"]> &
        keyof T["columns"]]: ColumnValue<T["columns"][K]>;
    }
  : TableRow<T>;

type IncludeResult<
  TRelations extends TableRelations,
  TOptions extends FindManyOptions<Table, TRelations>,
> = TOptions["include"] extends Record<string, true>
  ? {
      [K in keyof TOptions["include"]]: K extends keyof TRelations
        ? RelationType<TRelations[K]>
        : never;
    }
  : {};

export type FindManyResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends FindManyOptions<T, TRelations>,
> = Prettify<SelectResult<T, TOptions> & IncludeResult<TRelations, TOptions>>;

export type TableClient<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  findMany<const TOptions extends FindManyOptions<T, TRelations>>(
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TRelations, TOptions>>>;
};

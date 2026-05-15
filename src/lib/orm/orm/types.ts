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

type ExactlyOne<T extends Record<PropertyKey, unknown>> = {
  [TKey in keyof T]: {
    [TSelected in TKey]-?: T[TSelected];
  } & {
    [TOmitted in Exclude<keyof T, TKey>]?: never;
  };
}[keyof T];

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

type ColumnWhere<T extends Column> =
  ColumnRuntimeValue<T["type"]> extends object
    ? ColumnWhereOperators<T>
    : ColumnValue<T> | ColumnWhereOperators<T>;

export type TableWhere<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: ColumnWhere<T["columns"][TColumnName]>;
};

export type TableSelect<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: true;
};

export type TableOrderBy<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: "asc" | "desc";
};

export type TableInclude<TRelations extends TableRelations = TableRelations> =
  Partial<Record<keyof TRelations, boolean>>;

export type FindManyOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  where?: TableWhere<T>;
  select?: TableSelect<T>;
  orderBy?: TableOrderBy<T>;
  include?: TableInclude<TRelations>;
  take?: number;
  skip?: number;
};

export type FindFirstOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = Omit<FindManyOptions<T, TRelations>, "take">;

type TableColumns<T extends Table> = T["columns"];

type TableColumnByName<
  T extends Table,
  TColumnName extends keyof TableColumns<T>,
> = TableColumns<T>[TColumnName];

type IsUniqueColumn<TColumn extends Column> =
  TColumn["_meta"]["isPrimaryKey"] extends true
    ? true
    : TColumn["_meta"]["isUnique"] extends true
      ? true
      : false;

type FindUniqueColumnValue<TColumn extends Column> = NonNullable<
  ColumnValue<TColumn>
>;

type UniqueColumnKeys<T extends Table> = {
  [TColumnName in keyof TableColumns<T>]: IsUniqueColumn<
    TableColumnByName<T, TColumnName>
  > extends true
    ? TColumnName
    : never;
}[keyof TableColumns<T>];

type UniqueColumnWhereShape<T extends Table> = {
  [TColumnName in UniqueColumnKeys<T>]: FindUniqueColumnValue<
    TableColumnByName<T, TColumnName>
  >;
};

export type FindUniqueWhere<T extends Table> = ExactlyOne<
  UniqueColumnWhereShape<T>
>;

export type FindUniqueOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  where: FindUniqueWhere<T>;
  select?: TableSelect<T>;
  include?: TableInclude<TRelations>;
};

export type TableRow<T extends Table> = Prettify<{
  [TColumnName in keyof T["columns"]]: ColumnValue<T["columns"][TColumnName]>;
}>;

type IsRequiredCreateColumn<TColumn extends Column> =
  TColumn["_meta"]["isNullable"] extends false
    ? TColumn["_meta"]["hasDefault"] extends true
      ? false
      : true
    : false;

type CreateRequiredColumnKeys<T extends Table> = {
  [TColumnName in keyof TableColumns<T>]: IsRequiredCreateColumn<
    TableColumnByName<T, TColumnName>
  > extends true
    ? TColumnName
    : never;
}[keyof TableColumns<T>];

export type CreateData<T extends Table> = Prettify<
  {
    [TColumnName in CreateRequiredColumnKeys<T>]: ColumnValue<
      TableColumnByName<T, TColumnName>
    >;
  } & {
    [TColumnName in Exclude<
      keyof TableColumns<T>,
      CreateRequiredColumnKeys<T>
    >]?: ColumnValue<TableColumnByName<T, TColumnName>>;
  }
>;

export type CreateOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  data: CreateData<T>;
  select?: TableSelect<T>;
  include?: TableInclude<TRelations>;
};

export type CreateResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends CreateOptions<T, TRelations>,
> = Prettify<
  SelectResult<T, TOptions> & IncludeResult<T, TRelations, TOptions>
>;

export type UpdateData<T extends Table> = Partial<{
  [TColumnName in keyof TableColumns<T>]: ColumnValue<
    TableColumnByName<T, TColumnName>
  >;
}>;

export type UpdateOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  where: FindUniqueWhere<T>;
  data: UpdateData<T>;
  select?: TableSelect<T>;
  include?: TableInclude<TRelations>;
};

export type UpdateResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends UpdateOptions<T, TRelations>,
> = NonNullable<FindUniqueResult<T, TRelations, TOptions>>;

type HasManyRelationType<R extends HasMany<Table> | HasOne<Table>> =
  R extends HasMany<infer TTable> ? Array<TableRow<TTable>> : never;

type HasOneRelationType<R extends HasMany<Table> | HasOne<Table>> =
  R extends HasOne<infer TTable> ? TableRow<TTable> | null : never;

type IncludedKeys<TInclude> = {
  [K in keyof TInclude]: TInclude[K] extends true ? K : never;
}[keyof TInclude];

type SelectResult<
  T extends Table,
  TOptions extends { select?: TableSelect<T> },
> = TOptions["select"] extends TableSelect<T>
  ? {
      [K in keyof NonNullable<TOptions["select"]> &
        keyof T["columns"]]: ColumnValue<T["columns"][K]>;
    }
  : TableRow<T>;

type IncludeResult<
  _T extends Table,
  TRelations extends TableRelations,
  TOptions extends { include?: TableInclude<TRelations> },
> = TOptions["include"] extends TableInclude<TRelations>
  ? {
      [K in IncludedKeys<
        NonNullable<TOptions["include"]>
      >]: K extends keyof TRelations
        ? HasManyRelationType<TRelations[K]> | HasOneRelationType<TRelations[K]>
        : never;
    }
  : {};

export type FindManyResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends FindManyOptions<T, TRelations>,
> = Prettify<
  SelectResult<T, TOptions> & IncludeResult<T, TRelations, TOptions>
>;

export type FindFirstResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends FindFirstOptions<T, TRelations>,
> = Prettify<
  SelectResult<T, TOptions> & IncludeResult<T, TRelations, TOptions>
> | null;

export type FindUniqueResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends FindUniqueOptions<T, TRelations>,
> = Prettify<
  SelectResult<T, TOptions> & IncludeResult<T, TRelations, TOptions>
> | null;

export type TableClient<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  findMany<const TOptions extends FindManyOptions<T, TRelations>>(
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TRelations, TOptions>>>;

  findFirst<const TOptions extends FindFirstOptions<T, TRelations>>(
    options?: TOptions,
  ): Promise<FindFirstResult<T, TRelations, TOptions>>;

  findUnique<const TOptions extends FindUniqueOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<FindUniqueResult<T, TRelations, TOptions>>;

  create<const TOptions extends CreateOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<CreateResult<T, TRelations, TOptions>>;

  update<const TOptions extends UpdateOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<UpdateResult<T, TRelations, TOptions>>;
};

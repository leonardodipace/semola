import type { BaseColumn, Column } from "../column/types.js";
import type { Adapter } from "../dialect/index.js";
import type { Table } from "../table/types.js";

export type HasMany<T extends Table> = {
  _type: "hasMany";
  _table: T;
};

export type HasOne<T extends Table, TKey extends string = string> = {
  _type: "hasOne";
  _table: T;
  _foreignKey: TKey;
};

export type TableRelations = Record<string, HasMany<Table> | HasOne<Table>>;

export type RelationsFor<T extends Record<string, Table>> = {
  [TTableName in keyof T]?: {
    [key: string]:
      | HasMany<Table>
      | HasOne<Table, keyof T[TTableName]["columns"] & string>;
  };
};

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

export type OrmQueryOptions = {
  $skipHooks?: boolean;
};

export type CreateOrmOptions<
  T extends Record<string, Table> = Record<string, Table>,
  R extends RelationsFor<T> = RelationsFor<T>,
> = {
  adapter: Adapter;
  url: string;
  tables: T;
  relations?: R;
  hooks?: OrmHooksConfig<T, R>;
};

// Look up the raw relations for a table by matching its structural type against all tables.
// Uses bidirectional extends check to require exact structural match.
type RelationsForTableByType<
  TTable extends Table,
  TAllTables extends Record<string, Table>,
  TAllRelations,
> = {
  [K in keyof TAllTables]: TAllTables[K] extends TTable
    ? TTable extends TAllTables[K]
      ? K extends keyof TAllRelations
        ? NonNullable<TAllRelations[K]>
        : Record<never, never>
      : never
    : never;
}[keyof TAllTables] extends infer R
  ? [R] extends [TableRelations]
    ? R
    : Record<never, never>
  : Record<never, never>;

// Raw relations lookup for a table by its JS name key.
export type TableRelationsFor<
  TRelations,
  TTableName extends PropertyKey,
> = TTableName extends keyof TRelations
  ? NonNullable<TRelations[TTableName]>
  : Record<never, never>;

export type OrmClient<
  T extends Record<string, Table> = Record<string, Table>,
  R extends RelationsFor<T> = RelationsFor<T>,
> = {
  [TTableName in keyof T]: TableClient<
    T[TTableName],
    TableRelationsFor<R, TTableName>,
    T,
    R
  >;
} & {
  $raw: Bun.SQL;
  $transaction: <TResult>(
    callback: (tx: TransactionClient<T, R>) => Promise<TResult>,
  ) => Promise<TResult>;
};

export type TransactionClient<
  T extends Record<string, Table>,
  R extends RelationsFor<T> = RelationsFor<T>,
> = {
  [TTableName in keyof T]: TableClient<
    T[TTableName],
    TableRelationsFor<R, TTableName>,
    T,
    R
  >;
} & {
  $raw: Bun.SQL;
};

export type StringKeyOf<T extends object> = Extract<keyof T, string>;

export type ObjectEntries<T extends object> = {
  [K in StringKeyOf<T>]: [K, T[K]];
}[StringKeyOf<T>][];

export type OrmTableClients<
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
> = {
  [K in keyof T]: TableClient<T[K], TableRelationsFor<R, K>>;
};

type ColumnRuntimeValue<T extends Column> =
  T extends BaseColumn<boolean, boolean, boolean, boolean, infer TValue>
    ? TValue
    : never;

type ColumnValue<T extends Column> = T["_meta"]["isNullable"] extends false
  ? ColumnRuntimeValue<T>
  : ColumnRuntimeValue<T> | null;

type NonNullableColumnValue<T extends Column> = Exclude<ColumnValue<T>, null>;

type InWhereOperators<T extends Column> = {
  in?: NonNullableColumnValue<T>[];
  notIn?: NonNullableColumnValue<T>[];
};

type StringWhereOperators<T extends Column> = InWhereOperators<T> & {
  equals?: ColumnValue<T>;
  startsWith?: NonNullableColumnValue<T>;
  endsWith?: NonNullableColumnValue<T>;
  contains?: NonNullableColumnValue<T>;
};

type NumberWhereOperators<T extends Column> = InWhereOperators<T> & {
  equals?: ColumnValue<T>;
  gt?: NonNullableColumnValue<T>;
  gte?: NonNullableColumnValue<T>;
  lt?: NonNullableColumnValue<T>;
  lte?: NonNullableColumnValue<T>;
  between?: [NonNullableColumnValue<T>, NonNullableColumnValue<T>];
};

type BooleanWhereOperators<T extends Column> = InWhereOperators<T> & {
  equals?: ColumnValue<T>;
};

type DateWhereOperators<T extends Column> = InWhereOperators<T> & {
  equals?: ColumnValue<T>;
  gt?: NonNullableColumnValue<T>;
  gte?: NonNullableColumnValue<T>;
  lt?: NonNullableColumnValue<T>;
  lte?: NonNullableColumnValue<T>;
  between?: [NonNullableColumnValue<T>, NonNullableColumnValue<T>];
};

type EnumWhereOperators<T extends Column> = InWhereOperators<T> & {
  equals?: ColumnValue<T>;
};

type JsonWhereOperators<T extends Column> = InWhereOperators<T> & {
  equals?: ColumnValue<T>;
};

type ColumnWhereOperatorsMap<T extends Column> = {
  string: StringWhereOperators<T>;
  number: NumberWhereOperators<T>;
  boolean: BooleanWhereOperators<T>;
  date: DateWhereOperators<T>;
  enum: EnumWhereOperators<T>;
  json: JsonWhereOperators<T>;
  jsonb: JsonWhereOperators<T>;
};

type ColumnWhereOperators<T extends Column> =
  ColumnWhereOperatorsMap<T>[T["type"]];

type ColumnWhere<T extends Column> =
  ColumnRuntimeValue<T> extends object
    ? ColumnWhereOperators<T>
    : ColumnValue<T> | ColumnWhereOperators<T>;

type TableLogicalWhere<
  T extends Table,
  TRelations extends TableRelations = Record<never, never>,
> = {
  [TKey in "$or"]?: TableWhere<T, TRelations>[];
} & {
  [TKey in "$and" | "$not"]?:
    | TableWhere<T, TRelations>
    | TableWhere<T, TRelations>[];
};

type RelationWhereFilter<R extends HasMany<Table> | HasOne<Table>> = {
  every?: TableWhere<RelationTable<R>>;
  some?: TableWhere<RelationTable<R>>;
  none?: TableWhere<RelationTable<R>>;
} & (
  | { every: TableWhere<RelationTable<R>> }
  | { some: TableWhere<RelationTable<R>> }
  | { none: TableWhere<RelationTable<R>> }
);

type IsOpenTableRelations<TRelations extends TableRelations> =
  string extends keyof TRelations ? true : false;

type TableRelationWhere<TRelations extends TableRelations> =
  IsOpenTableRelations<TRelations> extends true
    ? Record<never, never>
    : {
        [K in keyof TRelations]?: RelationWhereFilter<TRelations[K]>;
      };

export type TableWhere<
  T extends Table,
  TRelations extends TableRelations = Record<never, never>,
> = TableLogicalWhere<T, TRelations> & {
  [TColumnName in keyof T["columns"]]?: ColumnWhere<T["columns"][TColumnName]>;
} & TableRelationWhere<TRelations>;

export type TableSelect<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: true;
};

export type TableOrderBy<T extends Table> = {
  [TColumnName in keyof T["columns"]]?: "asc" | "desc";
};

type RelationTable<R extends HasMany<Table> | HasOne<Table>> = R extends {
  _table: infer T extends Table;
}
  ? T
  : never;

// Resolves a relation's target table's known relations, falling back to TableRelations
// when none exist - prevents TypeScript from collapsing include options to never.
type RelationTableRelations<
  R extends HasMany<Table> | HasOne<Table>,
  TAllTables extends Record<string, Table>,
  TAllRelations,
> = [
  RelationsForTableByType<RelationTable<R>, TAllTables, TAllRelations>,
] extends [never]
  ? TableRelations
  : RelationsForTableByType<RelationTable<R>, TAllTables, TAllRelations>;

// TAllTables/TAllRelations thread through include options so nested include keys
// are validated and result types are inferred correctly at any depth.
export type RelationIncludeOptions<
  R extends HasMany<Table> | HasOne<Table>,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = {
  where?: TableWhere<RelationTable<R>>;
  orderBy?: TableOrderBy<RelationTable<R>>;
  take?: number;
  skip?: number;
  select?: TableSelect<RelationTable<R>>;
  include?: TableInclude<
    RelationTableRelations<R, TAllTables, TAllRelations>,
    TAllTables,
    TAllRelations
  >;
};

export type TableInclude<
  TRelations extends TableRelations = TableRelations,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = Partial<{
  [K in keyof TRelations]:
    | boolean
    | RelationIncludeOptions<TRelations[K], TAllTables, TAllRelations>;
}>;

export type FindManyOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = OrmQueryOptions & {
  where?: TableWhere<T, TRelations>;
  select?: TableSelect<T>;
  orderBy?: TableOrderBy<T>;
  include?: TableInclude<TRelations, TAllTables, TAllRelations>;
  take?: number;
  skip?: number;
};

export type FindFirstOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = Omit<FindManyOptions<T, TRelations, TAllTables, TAllRelations>, "take">;

type TableColumns<T extends Table> = T["columns"];

type TableColumnByName<
  T extends Table,
  TColumnName extends keyof TableColumns<T>,
> = TableColumns<T>[TColumnName];

type IsUniqueColumn<TColumn extends Column> =
  TColumn["_meta"]["isPrimaryKey"] extends true
    ? true
    : TColumn["_meta"]["isUnique"];

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

type NonUniqueColumnKeys<T extends Table> = Exclude<
  keyof TableColumns<T>,
  UniqueColumnKeys<T>
>;

export type FindUniqueWhere<T extends Table> = ExactlyOne<
  UniqueColumnWhereShape<T>
> & {
  [TColumnName in NonUniqueColumnKeys<T>]?: ColumnWhere<
    TableColumnByName<T, TColumnName>
  >;
};

export type FindUniqueOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = OrmQueryOptions & {
  where: FindUniqueWhere<T>;
  select?: TableSelect<T>;
  include?: TableInclude<TRelations, TAllTables, TAllRelations>;
};

export type TableRow<T extends Table> = Prettify<{
  [TColumnName in keyof T["columns"]]: ColumnValue<T["columns"][TColumnName]>;
}>;

// After-hook results use a row superset so hooks stay assignable when queries select or include.
export type TableHookResult<T extends Table> = Prettify<
  Partial<TableRow<T>> & Record<string, unknown>
>;

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
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = OrmQueryOptions & {
  data: CreateData<T>;
  select?: TableSelect<T>;
  include?: TableInclude<TRelations, TAllTables, TAllRelations>;
};

export type CreateResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends {
    select?: TableSelect<T>;
    include?: TableInclude<TRelations, TAllTables, TAllRelations>;
  },
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = Prettify<
  SelectResult<T, TOptions> &
    IncludeResult<TRelations, TOptions, TAllTables, TAllRelations>
>;

export type UpdateData<T extends Table> = Partial<{
  [TColumnName in keyof TableColumns<T>]: ColumnValue<
    TableColumnByName<T, TColumnName>
  >;
}>;

export type UpdateOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = OrmQueryOptions & {
  where: FindUniqueWhere<T>;
  data: UpdateData<T>;
  select?: TableSelect<T>;
  include?: TableInclude<TRelations, TAllTables, TAllRelations>;
};

export type UpdateResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends {
    where: FindUniqueWhere<T>;
    select?: TableSelect<T>;
    include?: TableInclude<TRelations, TAllTables, TAllRelations>;
  },
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = NonNullable<
  FindUniqueResult<T, TRelations, TOptions, TAllTables, TAllRelations>
>;

export type DeleteOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = FindUniqueOptions<T, TRelations, TAllTables, TAllRelations>;

export type DeleteResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends {
    where: FindUniqueWhere<T>;
    select?: TableSelect<T>;
    include?: TableInclude<TRelations, TAllTables, TAllRelations>;
  },
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = NonNullable<
  FindUniqueResult<T, TRelations, TOptions, TAllTables, TAllRelations>
>;

export type CreateManyOptions<T extends Table> = OrmQueryOptions & {
  data: CreateData<T>[];
};

export type UpdateManyOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = OrmQueryOptions & {
  where?: TableWhere<T, TRelations>;
  data: UpdateData<T>;
};

export type DeleteManyOptions<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
> = OrmQueryOptions & {
  where?: TableWhere<T, TRelations>;
};

type IncludedKeys<TInclude> = keyof {
  [K in keyof TInclude as TInclude[K] extends false | undefined
    ? never
    : K]: unknown;
};

type SelectResult<
  T extends Table,
  TOptions extends { select?: TableSelect<T> },
> = TOptions extends { select: infer TSelect extends TableSelect<T> }
  ? [keyof TSelect] extends [never]
    ? TableRow<T>
    : {
        [K in keyof TSelect & keyof T["columns"]]: ColumnValue<T["columns"][K]>;
      }
  : TableRow<T>;

// Non-recursive: handles select narrowing only.
// Uses `infer extends` to fuse the TSelect constraint check into a single condition,
// eliminating the duplicate TableRow<TTable> fallback arm.
type RelationBaseRow<
  TTable extends Table,
  TIncludeValue,
> = TIncludeValue extends { select: infer TSelect extends TableSelect<TTable> }
  ? SelectResult<TTable, { select: TSelect }>
  : TableRow<TTable>;

// Computes a single row for a relation result, handling nested select and include.
// Extracted to eliminate the identical ~20-line block duplicated in each branch
// of RelationResultType (HasMany vs HasOne only differ in wrapping, not row shape).
type RelationRow<
  TTable extends Table,
  TIncludeValue,
  TAllTables extends Record<string, Table>,
  TAllRelations,
> = Prettify<
  RelationBaseRow<TTable, TIncludeValue> &
    (TIncludeValue extends { include?: infer TNestedInclude }
      ? IncludeResult<
          RelationsForTableByType<TTable, TAllTables, TAllRelations>,
          TNestedInclude extends TableInclude<
            RelationsForTableByType<TTable, TAllTables, TAllRelations>,
            TAllTables,
            TAllRelations
          >
            ? { include: TNestedInclude }
            : {},
          TAllTables,
          TAllRelations
        >
      : {})
>;

// Dynamic nested relation lookup - works at any depth without phantom types.
// TAllTables + TAllRelations are threaded from OrmClient so RelationsForTableByType
// can resolve the related table's relations at every level of recursion.
type RelationResultType<
  R extends HasMany<Table> | HasOne<Table>,
  TIncludeValue,
  TAllTables extends Record<string, Table>,
  TAllRelations,
> =
  R extends HasMany<infer TTable>
    ? Array<RelationRow<TTable, TIncludeValue, TAllTables, TAllRelations>>
    : R extends HasOne<infer TTable>
      ? RelationRow<TTable, TIncludeValue, TAllTables, TAllRelations> | null
      : never;

type IncludeResult<
  TRelations extends TableRelations,
  TOptions extends {
    include?: TableInclude<TRelations, TAllTables, TAllRelations>;
  },
  TAllTables extends Record<string, Table>,
  TAllRelations,
> = [keyof TRelations] extends [never]
  ? {}
  : TOptions["include"] extends TableInclude<
        TRelations,
        TAllTables,
        TAllRelations
      >
    ? {
        [K in IncludedKeys<
          NonNullable<TOptions["include"]>
        >]: K extends keyof TRelations
          ? RelationResultType<
              TRelations[K],
              NonNullable<TOptions["include"]>[K],
              TAllTables,
              TAllRelations
            >
          : never;
      }
    : {};

export type FindManyResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends FindManyOptions<T, TRelations, TAllTables, TAllRelations>,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = Prettify<
  SelectResult<T, TOptions> &
    IncludeResult<TRelations, TOptions, TAllTables, TAllRelations>
>;

export type FindFirstResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends FindFirstOptions<T, TRelations, TAllTables, TAllRelations>,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = Prettify<
  SelectResult<T, TOptions> &
    IncludeResult<TRelations, TOptions, TAllTables, TAllRelations>
> | null;

export type FindUniqueResult<
  T extends Table,
  TRelations extends TableRelations,
  TOptions extends FindUniqueOptions<T, TRelations, TAllTables, TAllRelations>,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = Prettify<
  SelectResult<T, TOptions> &
    IncludeResult<TRelations, TOptions, TAllTables, TAllRelations>
> | null;

export type OrmHookContext<TOptions, TResult = undefined> = {
  tableName: string;
  table: Table;
  options: TOptions;
  result?: TResult;
};

export type OrmReadHookContext<TOptions, TResult = undefined> = {
  tableName: string;
  table: Table;
  readonly options: Readonly<TOptions>;
  result?: TResult;
};

type BeforeHookReturn<TResult> =
  | TResult
  | undefined
  | Promise<TResult | undefined>;

type BeforeCreateHookResult<
  TTable extends Table,
  TRelations extends TableRelations,
> = {
  data?: CreateOptions<TTable, TRelations>["data"];
};

type BeforeCreateManyHookResult<TTable extends Table> = {
  data?: CreateManyOptions<TTable>["data"];
};

type BeforeUpdateHookResult<
  TTable extends Table,
  TRelations extends TableRelations,
> = {
  where?: UpdateOptions<TTable, TRelations>["where"];
  data?: UpdateOptions<TTable, TRelations>["data"];
};

type BeforeUpdateManyHookResult<
  TTable extends Table,
  TRelations extends TableRelations,
> = {
  where?: UpdateManyOptions<TTable, TRelations>["where"];
  data?: UpdateManyOptions<TTable, TRelations>["data"];
};

type BeforeDeleteHookResult<
  TTable extends Table,
  TRelations extends TableRelations,
> = {
  where?: DeleteOptions<TTable, TRelations>["where"];
};

type BeforeDeleteManyHookResult<
  TTable extends Table,
  TRelations extends TableRelations,
> = {
  where?: DeleteManyOptions<TTable, TRelations>["where"];
};

export type OrmHookName =
  | "beforeFindMany"
  | "afterFindMany"
  | "beforeFindFirst"
  | "afterFindFirst"
  | "beforeFindUnique"
  | "afterFindUnique"
  | "beforeCreate"
  | "afterCreate"
  | "beforeCreateMany"
  | "afterCreateMany"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeUpdateMany"
  | "afterUpdateMany"
  | "beforeDelete"
  | "afterDelete"
  | "beforeDeleteMany"
  | "afterDeleteMany";

export type GlobalOrmHooks = {
  beforeFindMany?: <T extends Table>(
    ctx: OrmReadHookContext<FindManyOptions<T> | undefined>,
  ) => void | Promise<void>;
  afterFindMany?: <T extends Table>(
    ctx: OrmReadHookContext<FindManyOptions<T> | undefined, unknown[]>,
  ) => void | Promise<void>;
  beforeFindFirst?: <T extends Table>(
    ctx: OrmReadHookContext<FindFirstOptions<T> | undefined>,
  ) => void | Promise<void>;
  afterFindFirst?: <T extends Table>(
    ctx: OrmReadHookContext<FindFirstOptions<T> | undefined, unknown | null>,
  ) => void | Promise<void>;
  beforeFindUnique?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmReadHookContext<FindUniqueOptions<TTable, TRelations>>,
  ) => void | Promise<void>;
  afterFindUnique?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmReadHookContext<
      FindUniqueOptions<TTable, TRelations>,
      unknown | null
    >,
  ) => void | Promise<void>;
  beforeCreate?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<CreateOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeCreateHookResult<TTable, TRelations>>;
  afterCreate?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<CreateOptions<TTable, TRelations>, unknown>,
  ) => void | Promise<void>;
  beforeCreateMany?: <TTable extends Table>(
    ctx: OrmHookContext<CreateManyOptions<TTable>>,
  ) => BeforeHookReturn<BeforeCreateManyHookResult<TTable>>;
  afterCreateMany?: <TTable extends Table>(
    ctx: OrmHookContext<CreateManyOptions<TTable>, unknown[]>,
  ) => void | Promise<void>;
  beforeUpdate?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<UpdateOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeUpdateHookResult<TTable, TRelations>>;
  afterUpdate?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<UpdateOptions<TTable, TRelations>, unknown>,
  ) => void | Promise<void>;
  beforeUpdateMany?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<UpdateManyOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeUpdateManyHookResult<TTable, TRelations>>;
  afterUpdateMany?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<UpdateManyOptions<TTable, TRelations>, unknown[]>,
  ) => void | Promise<void>;
  beforeDelete?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<DeleteOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeDeleteHookResult<TTable, TRelations>>;
  afterDelete?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<DeleteOptions<TTable, TRelations>, unknown>,
  ) => void | Promise<void>;
  beforeDeleteMany?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<DeleteManyOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeDeleteManyHookResult<TTable, TRelations>>;
  afterDeleteMany?: <
    TTable extends Table,
    TRelations extends TableRelations = TableRelations,
  >(
    ctx: OrmHookContext<DeleteManyOptions<TTable, TRelations>, unknown[]>,
  ) => void | Promise<void>;
};

export type TableHooks<
  TTable extends Table,
  TRelations extends TableRelations = TableRelations,
> = {
  beforeFindMany?: (
    ctx: OrmReadHookContext<FindManyOptions<TTable, TRelations> | undefined>,
  ) => void | Promise<void>;
  afterFindMany?: (
    ctx: OrmReadHookContext<
      FindManyOptions<TTable, TRelations> | undefined,
      Array<TableHookResult<TTable>>
    >,
  ) => void | Promise<void>;
  beforeFindFirst?: (
    ctx: OrmReadHookContext<FindFirstOptions<TTable, TRelations> | undefined>,
  ) => void | Promise<void>;
  afterFindFirst?: (
    ctx: OrmReadHookContext<
      FindFirstOptions<TTable, TRelations> | undefined,
      TableHookResult<TTable> | null
    >,
  ) => void | Promise<void>;
  beforeFindUnique?: (
    ctx: OrmReadHookContext<FindUniqueOptions<TTable, TRelations>>,
  ) => void | Promise<void>;
  afterFindUnique?: (
    ctx: OrmReadHookContext<
      FindUniqueOptions<TTable, TRelations>,
      TableHookResult<TTable> | null
    >,
  ) => void | Promise<void>;
  beforeCreate?: (
    ctx: OrmHookContext<CreateOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeCreateHookResult<TTable, TRelations>>;
  afterCreate?: (
    ctx: OrmHookContext<
      CreateOptions<TTable, TRelations>,
      TableHookResult<TTable>
    >,
  ) => void | Promise<void>;
  beforeCreateMany?: (
    ctx: OrmHookContext<CreateManyOptions<TTable>>,
  ) => BeforeHookReturn<BeforeCreateManyHookResult<TTable>>;
  afterCreateMany?: (
    ctx: OrmHookContext<CreateManyOptions<TTable>, Array<TableRow<TTable>>>,
  ) => void | Promise<void>;
  beforeUpdate?: (
    ctx: OrmHookContext<UpdateOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeUpdateHookResult<TTable, TRelations>>;
  afterUpdate?: (
    ctx: OrmHookContext<
      UpdateOptions<TTable, TRelations>,
      TableHookResult<TTable>
    >,
  ) => void | Promise<void>;
  beforeUpdateMany?: (
    ctx: OrmHookContext<UpdateManyOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeUpdateManyHookResult<TTable, TRelations>>;
  afterUpdateMany?: (
    ctx: OrmHookContext<
      UpdateManyOptions<TTable, TRelations>,
      Array<TableRow<TTable>>
    >,
  ) => void | Promise<void>;
  beforeDelete?: (
    ctx: OrmHookContext<DeleteOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeDeleteHookResult<TTable, TRelations>>;
  afterDelete?: (
    ctx: OrmHookContext<
      DeleteOptions<TTable, TRelations>,
      TableHookResult<TTable>
    >,
  ) => void | Promise<void>;
  beforeDeleteMany?: (
    ctx: OrmHookContext<DeleteManyOptions<TTable, TRelations>>,
  ) => BeforeHookReturn<BeforeDeleteManyHookResult<TTable, TRelations>>;
  afterDeleteMany?: (
    ctx: OrmHookContext<
      DeleteManyOptions<TTable, TRelations>,
      Array<TableRow<TTable>>
    >,
  ) => void | Promise<void>;
};

export type OrmHooksConfig<
  T extends Record<string, Table>,
  R extends RelationsFor<T> = RelationsFor<T>,
> = GlobalOrmHooks & {
  tables?: {
    [K in keyof T]?: TableHooks<T[K], TableRelationsFor<R, K>>;
  };
};

export type CreateTableClientInput<
  T extends Table = Table,
  TRelations extends TableRelations = TableRelations,
> = {
  sql: Bun.SQL;
  tableName: string;
  table: T;
  adapter: Adapter;
  relations: TRelations;
  tableRelationsMap: Map<Table, TableRelations>;
  globalHooks?: GlobalOrmHooks;
  tableHooks?: TableHooks<T, TRelations>;
};

export type TableClient<
  T extends Table,
  TRelations extends TableRelations = TableRelations,
  TAllTables extends Record<string, Table> = Record<string, Table>,
  TAllRelations = Record<string, unknown>,
> = {
  findMany<
    const TOptions extends FindManyOptions<
      T,
      TRelations,
      TAllTables,
      TAllRelations
    >,
  >(
    options?: TOptions,
  ): Promise<
    Array<FindManyResult<T, TRelations, TOptions, TAllTables, TAllRelations>>
  >;

  findFirst<
    const TOptions extends FindFirstOptions<
      T,
      TRelations,
      TAllTables,
      TAllRelations
    >,
  >(
    options?: TOptions,
  ): Promise<
    FindFirstResult<T, TRelations, TOptions, TAllTables, TAllRelations>
  >;

  findUnique<
    const TOptions extends FindUniqueOptions<
      T,
      TRelations,
      TAllTables,
      TAllRelations
    >,
  >(
    options: TOptions,
  ): Promise<
    FindUniqueResult<T, TRelations, TOptions, TAllTables, TAllRelations>
  >;

  create<
    const TOptions extends CreateOptions<
      T,
      TRelations,
      TAllTables,
      TAllRelations
    >,
  >(
    options: TOptions,
  ): Promise<CreateResult<T, TRelations, TOptions, TAllTables, TAllRelations>>;

  createMany(options: CreateManyOptions<T>): Promise<Array<TableRow<T>>>;

  update<
    const TOptions extends UpdateOptions<
      T,
      TRelations,
      TAllTables,
      TAllRelations
    >,
  >(
    options: TOptions,
  ): Promise<UpdateResult<T, TRelations, TOptions, TAllTables, TAllRelations>>;

  updateMany(
    options: UpdateManyOptions<T, TRelations>,
  ): Promise<Array<TableRow<T>>>;

  delete<
    const TOptions extends DeleteOptions<
      T,
      TRelations,
      TAllTables,
      TAllRelations
    >,
  >(
    options: TOptions,
  ): Promise<DeleteResult<T, TRelations, TOptions, TAllTables, TAllRelations>>;

  deleteMany(
    options: DeleteManyOptions<T, TRelations>,
  ): Promise<Array<TableRow<T>>>;
};

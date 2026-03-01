import type { SQL } from "bun";
import type { CommonError } from "../errors/types.js";
import type { ColumnDef } from "./column.js";
import type { Table } from "./table.js";

export type ColumnKind =
  | "uuid"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "json"
  | "jsonb";

export type Dialect = "postgres" | "mysql" | "sqlite";

export type KindToType<K extends ColumnKind> = K extends "uuid" | "string"
  ? string
  : K extends "number"
    ? number
    : K extends "boolean"
      ? boolean
      : K extends "date"
        ? Date
        : unknown;

export type ColDefs = Record<
  string,
  ColumnDef<ColumnKind, ColumnMetaBase, unknown>
>;

export type ColumnMetaBase = {
  sqlName: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  defaultKind: "value" | "fn" | null;
  defaultValue: unknown;
  defaultFn: (() => unknown) | null;
  references: (() => ColumnDef<ColumnKind, ColumnMetaBase, unknown>) | null;
  onDeleteAction: "CASCADE" | "RESTRICT" | "SET NULL" | null;
};

export type DefaultColumnMeta = {
  sqlName: string;
  isPrimaryKey: false;
  isNotNull: false;
  isUnique: false;
  hasDefault: false;
  defaultKind: null;
  defaultValue: undefined;
  defaultFn: null;
  references: null;
  onDeleteAction: null;
};

type Prettify<T> = { [K in keyof T]: T[K] };

// Full row: required for all columns; nullable columns typed as V | null
export type TableRow<T extends ColDefs> = Prettify<{
  [K in keyof T]: T[K] extends ColumnDef<ColumnKind, ColumnMetaBase, infer V>
    ? T[K]["meta"]["isNotNull"] extends true
      ? V
      : V | null
    : never;
}>;

// InsertData: data shape for create/createMany
// Excludes DB-generated cols (uuid PK with no JS default); hasDefault cols are optional
export type InsertData<T extends ColDefs> = Prettify<
  {
    [K in keyof T as IsUserProvided<T[K]> extends true
      ? IsRequired<T[K]> extends true
        ? K
        : never
      : never]: T[K] extends ColumnDef<ColumnKind, ColumnMetaBase, infer V>
      ? V
      : never;
  } & {
    [K in keyof T as IsUserProvided<T[K]> extends true
      ? IsRequired<T[K]> extends true
        ? never
        : K
      : never]?: T[K] extends ColumnDef<ColumnKind, ColumnMetaBase, infer V>
      ? V
      : never;
  }
>;

// Excluded from InsertData: uuid PKs with no JS default (DB-generated)
type IsUserProvided<C> =
  C extends ColumnDef<"uuid", infer M>
    ? M["isPrimaryKey"] extends true
      ? M["hasDefault"] extends true
        ? true
        : false
      : true
    : true;

// Required in InsertData: isNotNull=true AND hasDefault=false
type IsRequired<C> =
  C extends ColumnDef<ColumnKind, infer M, unknown>
    ? M["isNotNull"] extends true
      ? M["hasDefault"] extends true
        ? false
        : true
      : false
    : false;

export type WhereInput<T extends ColDefs> = {
  [K in keyof T]?:
    | (T[K] extends ColumnDef<ColumnKind, ColumnMetaBase, infer V> ? V : never)
    | WhereFilter<
        T[K] extends ColumnDef<ColumnKind, ColumnMetaBase, infer V> ? V : never
      >;
};

// UniqueWhereInput: only unique/PK columns, direct equality only (no filter operators)
export type UniqueWhereInput<T extends ColDefs> = {
  [K in keyof T as T[K]["meta"]["isPrimaryKey"] extends true
    ? K
    : T[K]["meta"]["isUnique"] extends true
      ? K
      : never]?: T[K] extends ColumnDef<ColumnKind, ColumnMetaBase, infer V>
    ? V
    : never;
};

export type WhereFilter<V> = {
  equals?: V;
  not?: V;
  in?: V[];
  notIn?: V[];
  isNull?: boolean;
  endsWith?: string;
  startsWith?: string;
  contains?: string;
  gt?: V;
  lt?: V;
  gte?: V;
  lte?: V;
};

export type ManyRelation<TTable> = { kind: "many"; table: () => TTable };
export type OneRelation<TTable> = {
  kind: "one";
  foreignKey: string;
  table: () => TTable;
};
export type RelationDef<TTable> = ManyRelation<TTable> | OneRelation<TTable>;

export type RelationDefs = Record<string, RelationDef<Table<ColDefs>>>;

// Named method input types
export type FindManyInput<T extends ColDefs, TRels> = {
  where?: WhereInput<T>;
  include?: { [K in keyof TRels]?: true };
  orderBy?: Partial<Record<keyof T, OrderDirection>>;
  take?: number;
  skip?: number;
};

export type FindFirstInput<T extends ColDefs, TRels> = FindManyInput<T, TRels>;

export type FindUniqueInput<T extends ColDefs> = {
  where: UniqueWhereInput<T>;
};

export type CreateInput<T extends ColDefs> = {
  data: InsertData<T>;
};

export type CreateManyInput<T extends ColDefs> = {
  data: InsertData<T>[];
};

export type UpdateInput<T extends ColDefs> = {
  where: WhereInput<T>;
  data: Partial<InsertData<T>>;
};

export type UpdateManyInput<T extends ColDefs> = {
  where: WhereInput<T>;
  data: Partial<InsertData<T>>;
};

export type DeleteInput<T extends ColDefs> = {
  where: WhereInput<T>;
};

export type DeleteManyInput<T extends ColDefs> = {
  where: WhereInput<T>;
};

export type OrderDirection = "asc" | "desc";

export type SelectInput<T extends ColDefs, TRels> = {
  where?: WhereInput<T>;
  include?: { [K in keyof TRels]?: true };
  orderBy?: Partial<Record<keyof T, OrderDirection>>;
  limit?: number;
  offset?: number;
};

export type InsertInput<T extends ColDefs> = {
  data: InsertData<T>;
  returning?: boolean;
};

export type UpdateBuilderInput<T extends ColDefs> = {
  where: WhereInput<T>;
  data: Partial<InsertData<T>>;
  returning?: boolean;
};

export type DeleteBuilderInput<T extends ColDefs> = {
  where: WhereInput<T>;
  returning?: boolean;
};

export type ClauseOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "in"
  | "not_in"
  | "is_null"
  | "is_not_null";

export type WherePredicate<T extends ColDefs> = {
  kind: "predicate";
  key: keyof T & string;
  op: ClauseOperator;
  value?: unknown;
};

export type WhereNode<T extends ColDefs> =
  | WherePredicate<T>
  | {
      kind: "and";
      nodes: WhereNode<T>[];
    }
  | {
      kind: "or";
      nodes: WhereNode<T>[];
    };

export type JoinKind = "inner" | "left";

export type JoinNode = {
  relationKey: string;
  kind: JoinKind;
};

export type LimitOffsetNode = {
  limit?: number;
  offset?: number;
};

export type SelectPlan<T extends ColDefs> = {
  where?: WhereNode<T>;
  joins: JoinNode[];
  orderBy: Array<{ key: keyof T & string; direction: OrderDirection }>;
  page: LimitOffsetNode;
};

export type DialectAdapter = {
  dialect: Dialect;
  quoteIdentifier: (identifier: string) => string;
  serializeValue: (
    kind: ColumnKind,
    value: unknown,
  ) => string | number | boolean | null | unknown;
  renderLikePattern: (
    mode: "startsWith" | "endsWith" | "contains",
    value: string,
  ) => string;
};

export type OrmResultError = {
  type: CommonError;
  message: string;
};

export type ResultTuple<T> =
  | readonly [null, T]
  | readonly [OrmResultError, null];

export type TinyTableClient<T extends ColDefs, TRels> = {
  select: (input?: SelectInput<T, TRels>) => SQL.Query<TableRow<T>[]>;
  findMany: (
    input?: FindManyInput<T, TRels>,
  ) => Promise<ResultTuple<TableRow<T>[]>>;

  findFirst: (
    input?: FindFirstInput<T, TRels>,
  ) => Promise<ResultTuple<TableRow<T> | null>>;

  findUnique: (
    input: FindUniqueInput<T>,
  ) => Promise<ResultTuple<TableRow<T> | null>>;

  insert: <TReturning extends boolean | undefined = undefined>(
    input: InsertInput<T> & { returning?: TReturning },
  ) => SQL.Query<TReturning extends true ? TableRow<T>[] : unknown>;

  create: (input: CreateInput<T>) => Promise<ResultTuple<TableRow<T>>>;

  createMany: (
    input: CreateManyInput<T>,
  ) => Promise<ResultTuple<{ count: number; rows: TableRow<T>[] }>>;

  update: <TReturning extends boolean | undefined = undefined>(
    input: UpdateBuilderInput<T> & { returning?: TReturning },
  ) => SQL.Query<TReturning extends true ? TableRow<T>[] : unknown>;

  updateMany: (
    input: UpdateManyInput<T>,
  ) => Promise<ResultTuple<{ count: number; rows: TableRow<T>[] }>>;

  delete: <TReturning extends boolean | undefined = undefined>(
    input: DeleteBuilderInput<T> & { returning?: TReturning },
  ) => SQL.Query<TReturning extends true ? TableRow<T>[] : unknown>;

  deleteMany: (
    input: DeleteManyInput<T>,
  ) => Promise<ResultTuple<{ count: number; rows: TableRow<T>[] }>>;
};

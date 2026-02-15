import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta, ColumnValue } from "../column/types.js";
import type { IncludeOptions } from "../relations/types.js";
import type { Table } from "./index.js";

type IsNullable<Meta extends ColumnMeta> = Meta["primaryKey"] extends true
  ? false
  : Meta["notNull"] extends true
    ? false
    : true;

// For create: required fields are non-nullable with no default, excluding primary keys
type IsCreateRequired<Meta extends ColumnMeta> = Meta["primaryKey"] extends true
  ? false
  : Meta["notNull"] extends true
    ? Meta["hasDefault"] extends true
      ? false
      : true
    : false;

type CreateRequiredColumns<Cols> = {
  [K in keyof Cols]: Cols[K] extends Column<infer _K, infer M>
    ? IsCreateRequired<M> extends true
      ? K
      : never
    : never;
}[keyof Cols];

type CreateOptionalColumns<Cols> = {
  [K in keyof Cols]: Cols[K] extends Column<infer _K, infer M>
    ? IsCreateRequired<M> extends true
      ? never
      : K
    : never;
}[keyof Cols];

type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type InferTableType<T extends Table> =
  T extends Table<infer Cols>
    ? Prettify<{
        [K in keyof Cols]: Cols[K] extends Column<infer Kind, infer Meta>
          ? ColumnValue<Kind> | (IsNullable<Meta> extends true ? null : never)
          : never;
      }>
    : never;

// String filter operators
export type StringFilter = {
  equals?: string;
  contains?: string;
  in?: string[];
};

// Number filter operators
export type NumberFilter = {
  equals?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: number[];
};

// Date filter operators
export type DateFilter = {
  equals?: Date;
  gt?: Date;
  gte?: Date;
  lt?: Date;
  lte?: Date;
  in?: Date[];
};

// Boolean filter operators
export type BooleanFilter = {
  equals?: boolean;
};

// Map column kind to its filter type
type ColumnFilter<Kind extends ColumnKind> = Kind extends "string"
  ? string | null | StringFilter
  : Kind extends "number"
    ? number | null | NumberFilter
    : Kind extends "date"
      ? Date | null | DateFilter
      : boolean | null | BooleanFilter;

export type WhereClause<T extends Table> =
  T extends Table<infer Cols, infer _Rels>
    ? {
        [K in keyof Cols]?: Cols[K] extends Column<infer Kind, ColumnMeta>
          ? ColumnFilter<Kind>
          : never;
      }
    : never;

export type FindManyOptions<T extends Table> = {
  where?: WhereClause<T>;
  take?: number;
  skip?: number;
  include?: IncludeOptions<T>;
};

export type FindFirstOptions<T extends Table> = {
  where?: WhereClause<T>;
  include?: IncludeOptions<T>;
};

export type FindUniqueOptions<T extends Table> = {
  where: WhereClause<T>;
  include?: IncludeOptions<T>;
};
export type CreateInput<T extends Table> =
  T extends Table<infer Cols>
    ? Prettify<
        {
          [K in CreateRequiredColumns<Cols>]: Cols[K] extends Column<
            infer Kind,
            ColumnMeta
          >
            ? ColumnValue<Kind>
            : never;
        } & {
          [K in CreateOptionalColumns<Cols>]?: Cols[K] extends Column<
            infer Kind,
            infer Meta
          >
            ? ColumnValue<Kind> | (IsNullable<Meta> extends true ? null : never)
            : never;
        }
      >
    : never;

export type UpdateInput<T extends Table> =
  T extends Table<infer Cols>
    ? Prettify<{
        [K in keyof Cols]?: Cols[K] extends Column<infer Kind, infer Meta>
          ? ColumnValue<Kind> | (IsNullable<Meta> extends true ? null : never)
          : never;
      }>
    : never;

export type UpdateOptions<T extends Table> = {
  where: WhereClause<T>;
  data: UpdateInput<T>;
};

export type DeleteOptions<T extends Table> = {
  where: WhereClause<T>;
};

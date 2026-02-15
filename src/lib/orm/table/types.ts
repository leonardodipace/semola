import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta, ColumnValue } from "../column/types.js";
import type { IncludeOptions } from "../relations/types.js";
import type { Table } from "./index.js";

type IsRequired<Meta extends ColumnMeta> = Meta["primaryKey"] extends true
  ? true
  : Meta["notNull"] extends true
    ? true
    : Meta["hasDefault"] extends true
      ? true
      : false;

type RequiredColumns<Cols> = {
  [K in keyof Cols]: Cols[K] extends Column<infer _K, infer M>
    ? IsRequired<M> extends true
      ? K
      : never
    : never;
}[keyof Cols];

type OptionalColumns<Cols> = {
  [K in keyof Cols]: Cols[K] extends Column<infer _K, infer M>
    ? IsRequired<M> extends true
      ? never
      : K
    : never;
}[keyof Cols];

type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type InferTableType<T extends Table> =
  T extends Table<infer Cols>
    ? Prettify<
        {
          [K in RequiredColumns<Cols>]: Cols[K] extends Column<
            infer Kind,
            ColumnMeta
          >
            ? ColumnValue<Kind>
            : never;
        } & {
          [K in OptionalColumns<Cols>]?: Cols[K] extends Column<
            infer Kind,
            ColumnMeta
          >
            ? ColumnValue<Kind> | null
            : never;
        }
      >
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
  T extends Table<infer Cols, any>
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

import type { Column } from "./column.js";
import type { Table, TableClient } from "./table.js";

export type ColumnKind = "number" | "string" | "boolean" | "date";

export type ColumnValue<Kind extends ColumnKind> = Kind extends "number"
  ? number
  : Kind extends "string"
    ? string
    : Kind extends "date"
      ? Date
      : boolean;

export type ColumnMeta = {
  primaryKey: boolean;
  notNull: boolean;
  hasDefault: boolean;
  unique: boolean;
};

export type DefaultColumnMeta = {
  primaryKey: false;
  notNull: false;
  hasDefault: false;
  unique: false;
};

export type ColumnOptions<Kind extends ColumnKind> = {
  primaryKey: boolean;
  notNull: boolean;
  unique: boolean;
  defaultValue?: ColumnValue<Kind>;
};

export type OrmOptions<Tables extends Record<string, Table>> = {
  url: string;
  tables: Tables;
};

export type TableClients<Tables extends Record<string, Table>> = {
  [K in keyof Tables]: TableClient<Tables[K]>;
};

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
};

// Number filter operators
export type NumberFilter = {
  equals?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
};

// Date filter operators
export type DateFilter = {
  equals?: Date;
  gt?: Date;
  gte?: Date;
  lt?: Date;
  lte?: Date;
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
  T extends Table<infer Cols>
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
};

export type FindFirstOptions<T extends Table> = {
  where?: WhereClause<T>;
  skip?: number;
};

export type FindUniqueOptions<T extends Table> = {
  where: WhereClause<T>;
};

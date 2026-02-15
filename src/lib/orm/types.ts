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
};

export type DefaultColumnMeta = {
  primaryKey: false;
  notNull: false;
  hasDefault: false;
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

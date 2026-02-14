import type { Table } from "./table.js";

export type ColumnKind = "number" | "string" | "boolean";

export type ColumnValue<Kind extends ColumnKind> = Kind extends "number"
  ? number
  : Kind extends "string"
    ? string
    : boolean;

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

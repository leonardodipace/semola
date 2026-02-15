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

export type ColumnKind =
  | "number"
  | "string"
  | "boolean"
  | "date"
  | "json"
  | "jsonb"
  | "uuid";

export type ColumnValue<Kind extends ColumnKind> = Kind extends "number"
  ? number
  : Kind extends "string"
    ? string
    : Kind extends "date"
      ? Date
      : Kind extends "boolean"
        ? boolean
        : Kind extends "json" | "jsonb"
          ? unknown
          : string; // uuid is a string

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

// Helper type to update a single key in metadata
export type UpdateMeta<
  Meta extends ColumnMeta,
  Key extends keyof ColumnMeta,
  Value extends boolean,
> = {
  primaryKey: Key extends "primaryKey" ? Value : Meta["primaryKey"];
  notNull: Key extends "notNull" ? Value : Meta["notNull"];
  hasDefault: Key extends "hasDefault" ? Value : Meta["hasDefault"];
  unique: Key extends "unique" ? Value : Meta["unique"];
};

export type ColumnOptions<Kind extends ColumnKind> = {
  primaryKey: boolean;
  notNull: boolean;
  unique: boolean;
  defaultValue?: ColumnValue<Kind>;
};

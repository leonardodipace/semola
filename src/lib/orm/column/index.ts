import type {
  ColumnKind,
  ColumnMeta,
  ColumnOptions,
  ColumnValue,
  DefaultColumnMeta,
  UpdateMeta,
} from "./types.js";

export type {
  ColumnKind,
  ColumnMeta,
  ColumnOptions,
  ColumnValue,
  DefaultColumnMeta,
  UpdateMeta,
} from "./types.js";

const defaultOptions = {
  primaryKey: false,
  notNull: false,
  unique: false,
};

export class Column<
  Kind extends ColumnKind,
  Meta extends ColumnMeta = DefaultColumnMeta,
  Value = ColumnValue<Kind>,
> {
  private readonly _sqlName: string;
  private readonly kind: Kind;
  private readonly options: ColumnOptions<Kind, Value>;

  public constructor(
    sqlName: string,
    kind: Kind,
    options: ColumnOptions<Kind, Value> = defaultOptions,
  ) {
    this._sqlName = sqlName;
    this.kind = kind;
    this.options = options;
  }

  public static create<
    Kind extends ColumnKind,
    Meta extends ColumnMeta,
    Value = ColumnValue<Kind>,
  >(sqlName: string, kind: Kind, options: ColumnOptions<Kind, Value>) {
    return new Column<Kind, Meta, Value>(sqlName, kind, options);
  }

  public get sqlName() {
    return this._sqlName;
  }

  public get columnKind() {
    return this.kind;
  }

  public get meta() {
    return {
      primaryKey: this.options.primaryKey,
      notNull: this.options.notNull,
      unique: this.options.unique,
      hasDefault: this.options.defaultValue !== undefined,
    };
  }

  public get defaultValue() {
    return this.options.defaultValue;
  }

  public primaryKey() {
    return this.withOptions<UpdateMeta<Meta, "primaryKey", true>>({
      primaryKey: true,
    });
  }

  public notNull() {
    return this.withOptions<UpdateMeta<Meta, "notNull", true>>({
      notNull: true,
    });
  }

  public unique() {
    return this.withOptions<UpdateMeta<Meta, "unique", true>>({ unique: true });
  }

  public default(value: Value) {
    return this.withOptions<UpdateMeta<Meta, "hasDefault", true>>({
      defaultValue: value,
    });
  }

  private withOptions<NewMeta extends ColumnMeta>(
    options: Partial<ColumnOptions<Kind, Value>>,
  ) {
    return Column.create<Kind, NewMeta, Value>(this._sqlName, this.kind, {
      ...this.options,
      ...options,
    });
  }
}

export const number = (sqlName: string) => {
  return new Column<"number", DefaultColumnMeta>(sqlName, "number");
};

export const string = (sqlName: string) => {
  return new Column<"string", DefaultColumnMeta>(sqlName, "string");
};

export const boolean = (sqlName: string) => {
  return new Column<"boolean", DefaultColumnMeta>(sqlName, "boolean");
};

export const date = (sqlName: string) => {
  return new Column<"date", DefaultColumnMeta>(sqlName, "date");
};

// Postgres-specific column types
export const json = <T = unknown>(sqlName: string) => {
  return new Column<"json", DefaultColumnMeta, T>(sqlName, "json");
};

export const jsonb = <T = unknown>(sqlName: string) => {
  return new Column<"jsonb", DefaultColumnMeta, T>(sqlName, "jsonb");
};

export const uuid = (sqlName: string) => {
  return new Column<"uuid", DefaultColumnMeta>(sqlName, "uuid");
};

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
> {
  private readonly _sqlName: string;
  private readonly kind: Kind;
  private readonly options: ColumnOptions<Kind>;

  public constructor(
    sqlName: string,
    kind: Kind,
    options: ColumnOptions<Kind> = defaultOptions,
  ) {
    this._sqlName = sqlName;
    this.kind = kind;
    this.options = options;
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
      hasDefault: !!this.options.defaultValue,
    };
  }

  public primaryKey(): Column<Kind, UpdateMeta<Meta, "primaryKey", true>> {
    return this.withOptions({ primaryKey: true }) as Column<
      Kind,
      UpdateMeta<Meta, "primaryKey", true>
    >;
  }

  public notNull(): Column<Kind, UpdateMeta<Meta, "notNull", true>> {
    return this.withOptions({ notNull: true }) as Column<
      Kind,
      UpdateMeta<Meta, "notNull", true>
    >;
  }

  public unique(): Column<Kind, UpdateMeta<Meta, "unique", true>> {
    return this.withOptions({ unique: true }) as Column<
      Kind,
      UpdateMeta<Meta, "unique", true>
    >;
  }

  public default(
    value: ColumnValue<Kind>,
  ): Column<Kind, UpdateMeta<Meta, "hasDefault", true>> {
    return this.withOptions({ defaultValue: value }) as Column<
      Kind,
      UpdateMeta<Meta, "hasDefault", true>
    >;
  }

  private withOptions(options: Partial<ColumnOptions<Kind>>) {
    return new Column(this._sqlName, this.kind, {
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

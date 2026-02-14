import type { ColumnKind, ColumnOptions, ColumnValue } from "./types.js";

const defaultOptions = {
  primaryKey: false,
  notNull: false,
  unique: false,
};

export class Column<Kind extends ColumnKind> {
  private readonly sqlName: string;
  private readonly kind: Kind;
  private readonly options: ColumnOptions<Kind>;

  public constructor(
    sqlName: string,
    kind: Kind,
    options: ColumnOptions<Kind> = defaultOptions,
  ) {
    this.sqlName = sqlName;
    this.kind = kind;
    this.options = options;
  }

  public primaryKey() {
    return this.withOptions({ primaryKey: true });
  }

  public notNull() {
    return this.withOptions({ notNull: true });
  }

  public unique() {
    return this.withOptions({ unique: true });
  }

  public default(value: ColumnValue<Kind>) {
    return this.withOptions({ defaultValue: value });
  }

  private withOptions(next: Partial<ColumnOptions<Kind>>) {
    return new Column(this.sqlName, this.kind, { ...this.options, ...next });
  }
}

export const number = (sqlName: string) => {
  return new Column(sqlName, "number");
};

export const string = (sqlName: string) => {
  return new Column(sqlName, "string");
};

export const boolean = (sqlName: string) => {
  return new Column(sqlName, "boolean");
};

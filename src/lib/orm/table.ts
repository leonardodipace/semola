import type { Column } from "./column.js";
import type { ColumnKind } from "./types.js";

export class Table<
  Columns extends Record<string, Column<ColumnKind>> = Record<
    string,
    Column<ColumnKind>
  >,
> {
  private readonly _sqlName: string;
  private readonly _columns: Columns;

  public constructor(sqlName: string, columns: Columns) {
    this._sqlName = sqlName;
    this._columns = columns;
  }

  public get sqlName() {
    return this._sqlName;
  }

  public get columns() {
    return this._columns;
  }
}

export class TableClient<T extends Table> {
  private readonly sql: Bun.SQL;
  private readonly table: T;

  public constructor(sql: Bun.SQL, table: T) {
    this.sql = sql;
    this.table = table;
  }

  public async findMany() {
    return this.sql`SELECT * FROM ${this.sql(this.table.sqlName)}`;
  }
}

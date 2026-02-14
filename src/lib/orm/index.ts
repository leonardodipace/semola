import type { Table } from "./table.js";
import type { OrmOptions } from "./types.js";

export * from "./column.js";
export * from "./table.js";

export class Orm<Tables extends Record<string, Table>> {
  private readonly sql: Bun.SQL;
  private readonly options: OrmOptions<Tables>;

  public constructor(options: OrmOptions<Tables>) {
    this.options = options;
    this.sql = new Bun.SQL(options.url);
  }

  public get tables() {
    return this.options.tables;
  }
}

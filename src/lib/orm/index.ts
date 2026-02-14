import type { OrmOptions } from "./types.js";

export * from "./column.js";
export * from "./table.js";

export class Orm {
  private readonly sql: Bun.SQL;
  private readonly options: OrmOptions;

  public constructor(options: OrmOptions) {
    this.options = options;
    this.sql = new Bun.SQL(options.url);
  }
}

import type { Table } from "./table.js";
import { TableClient } from "./table.js";
import type { OrmOptions, TableClients } from "./types.js";

export * from "./column.js";
export * from "./table.js";
export * from "./types.js";

const bindTables = <Tables extends Record<string, Table>>(
  sql: Bun.SQL,
  tables: Tables,
) => {
  const result: Record<string, TableClient<Table>> = {};

  for (const [key, table] of Object.entries(tables)) {
    result[key] = new TableClient(sql, table);
  }

  return result as TableClients<Tables>;
};

export class Orm<Tables extends Record<string, Table>> {
  private readonly _tables: TableClients<Tables>;
  public readonly sql: Bun.SQL;

  public constructor(options: OrmOptions<Tables>) {
    this.sql = new Bun.SQL(options.url);
    this._tables = bindTables(this.sql, options.tables);
  }

  public get tables() {
    return this._tables;
  }
}

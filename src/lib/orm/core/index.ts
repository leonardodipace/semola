import type { Relation } from "../relations/types.js";
import type { Table } from "../table/index.js";
import { TableClient } from "../table/index.js";
import type { OrmDialect, OrmOptions, TableClients } from "./types.js";

export type { OrmOptions, TableClients } from "./types.js";

const bindTables = <
  Tables extends Record<string, Table>,
  Relations extends Record<string, Record<string, Relation>>,
>(
  sql: Bun.SQL,
  tables: Tables,
  relations?: Relations,
  dialect: OrmDialect = "sqlite",
) => {
  const result: Record<string, TableClient<Table>> = {};
  const tableNameMap = new Map<Table, string>();

  // Build map of Table instances to their names
  for (const key in tables) {
    const match = tables[key];

    if (!match) continue;

    tableNameMap.set(match, key);
  }

  for (const key in tables) {
    const match = tables[key];

    if (!match) continue;

    result[key] = new TableClient(
      sql,
      match,
      relations?.[key],
      (relation) => {
        const relatedTable = relation.table();
        const relatedTableName = tableNameMap.get(relatedTable);
        return relatedTableName ? result[relatedTableName] : undefined;
      },
      dialect,
    );
  }

  return result as unknown as TableClients<Tables, Relations>;
};

export class Orm<
  Tables extends Record<string, Table>,
  Relations extends Record<string, Record<string, Relation>> = {},
> {
  private readonly _tables: TableClients<Tables, Relations>;
  public readonly sql: Bun.SQL;

  public constructor(options: OrmOptions<Tables, Relations>) {
    this.sql = new Bun.SQL(options.url);
    const dialect = options.dialect ?? "sqlite";
    this._tables = bindTables(
      this.sql,
      options.tables,
      options.relations,
      dialect,
    );
  }

  public get tables() {
    return this._tables;
  }

  public close() {
    this.sql.close();
  }
}

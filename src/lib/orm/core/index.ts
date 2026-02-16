import {
  MysqlDialect,
  PostgresDialect,
  SqliteDialect,
} from "../dialect/index.js";
import type { Dialect } from "../dialect/types.js";
import type { Relation } from "../relations/types.js";
import type { Table } from "../table/index.js";
import { TableClient } from "../table/index.js";
import type { OrmDialect, OrmOptions, TableClients } from "./types.js";

export type { OrmOptions, TableClients } from "./types.js";

const createDialect = (name: OrmDialect): Dialect => {
  if (name === "postgres") {
    return new PostgresDialect();
  }
  if (name === "mysql") {
    return new MysqlDialect();
  }
  return new SqliteDialect();
};

const bindTables = <
  Tables extends Record<string, Table>,
  Relations extends Record<string, Record<string, Relation>>,
>(
  sql: Bun.SQL,
  tables: Tables,
  dialect: Dialect,
  relations?: Relations,
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
      dialect,
      relations?.[key],
      (relation) => {
        const relatedTable = relation.table();
        const relatedTableName = tableNameMap.get(relatedTable);
        return relatedTableName ? result[relatedTableName] : undefined;
      },
    );
  }

  return result as unknown as TableClients<Tables, Relations>;
};

export class Orm<
  Tables extends Record<string, Table>,
  Relations extends Record<string, Record<string, Relation>> = {},
> {
  private readonly _tables: TableClients<Tables, Relations>;
  private readonly dialect: Dialect;
  public readonly sql: Bun.SQL;

  public constructor(options: OrmOptions<Tables, Relations>) {
    this.sql = new Bun.SQL(options.url);
    this.dialect = createDialect(options.dialect ?? "sqlite");
    this._tables = bindTables(
      this.sql,
      options.tables,
      this.dialect,
      options.relations,
    );
  }

  public get tables() {
    return this._tables;
  }

  public getDialect() {
    return this.dialect;
  }

  public getDialectName() {
    return this.dialect.name;
  }

  // Generate CREATE TABLE statement for the given table using the current dialect.
  // Returns the SQL string. Users should execute it manually:
  // const ddl = orm.createTable(table);
  // await orm.sql.unsafe(ddl);
  public createTable(table: Table): string {
    return this.dialect.buildCreateTable(table);
  }

  public close() {
    this.sql.close();
  }
}

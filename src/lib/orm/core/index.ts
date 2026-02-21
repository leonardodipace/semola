import { err, mightThrow, ok } from "../../errors/index.js";
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

const createDialect = (name: OrmDialect) => {
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
  connectionUrl: string,
  relations?: Relations,
) => {
  const result: TableClients<Tables, Relations> = Object.create(null);
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

    Object.defineProperty(result, key, {
      value: new TableClient(
        sql,
        match,
        dialect,
        connectionUrl,
        relations?.[key],
        (relation) => {
          const relatedTable = relation.table();
          const relatedTableName = tableNameMap.get(relatedTable);
          if (!relatedTableName) return undefined;
          return result[relatedTableName];
        },
      ),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return result;
};

export class Orm<
  Tables extends Record<string, Table>,
  Relations extends Record<string, Record<string, Relation>> = {},
> {
  private readonly _tables: TableClients<Tables, Relations>;
  private readonly dialect: Dialect;
  private readonly connectionUrl: string;
  private readonly rawTables: Tables;
  private readonly rawRelations?: Relations;
  public readonly sql: Bun.SQL;

  public constructor(options: OrmOptions<Tables, Relations>) {
    this.sql = new Bun.SQL(options.url);
    this.connectionUrl = options.url;
    this.dialect = createDialect(options.dialect ?? "sqlite");
    this.rawTables = options.tables;
    this.rawRelations = options.relations;
    this._tables = bindTables(
      this.sql,
      options.tables,
      this.dialect,
      this.connectionUrl,
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
  // Returns [error, null] on unsupported column type or [null, sql] on success.
  // Users should execute the SQL manually:
  // const [error, ddl] = orm.createTable(table);
  // if (error) throw new Error(error.message);
  // await orm.sql.unsafe(ddl);
  public createTable(table: Table) {
    return this.dialect.buildCreateTable(table);
  }

  public async transaction<R>(
    fn: (tx: {
      tables: TableClients<Tables, Relations>;
    }) => Promise<
      readonly [{ type: string; message: string } | null, R | null]
    >,
  ) {
    const [txError, txResult] = await mightThrow(
      this.sql.begin(async (txSql) => {
        const txTables = bindTables(
          txSql,
          this.rawTables,
          this.dialect,
          this.connectionUrl,
          this.rawRelations,
        );

        const [fnError, fnResult] = await fn({ tables: txTables });

        if (fnError) {
          throw new Error(fnError.message);
        }

        return fnResult;
      }),
    );

    if (txError) {
      return err(
        "InternalServerError",
        txError instanceof Error ? txError.message : String(txError),
      );
    }

    return ok(txResult as R);
  }

  public async close() {
    await this.sql.close();
  }
}

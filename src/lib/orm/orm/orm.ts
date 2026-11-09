import { mightThrowSync } from "../../errors/index.js";
import { getDialectSpec } from "../dialect/index.js";
import type { Adapter } from "../dialect/types.js";
import { OrmError } from "../errors.js";
import type { Table } from "../table/types.js";
import type { Sql, SqlClient, SqlTransaction } from "../types.js";
import { pickGlobalHooks } from "./hook-runner.js";
import { TableClientImpl } from "./table-client.js";
import type {
  CreateOrmOptions,
  ObjectEntries,
  OrmClient,
  OrmPoolOptions,
  OrmTableClients,
  RelationsFor,
  StringKeyOf,
  TableRelations,
  TableRelationsFor,
  TransactionClient,
} from "./types.js";

const connectionUrls = new WeakMap<object, string | undefined>();

const redactDatabaseUrl = (url?: string) => {
  if (url === undefined) return url;
  if (!url.includes("://")) return url;

  const [error, parsed] = mightThrowSync(() => new URL(url));

  if (error) return url;
  if (!parsed.username) {
    if (!parsed.password) return url;
  }

  parsed.username = "";
  parsed.password = "";

  return parsed.href;
};

export const openBunSql = (
  adapter: Adapter,
  url: string,
  pool?: OrmPoolOptions,
) => {
  if (typeof Bun === "undefined") {
    throw new OrmError(
      "createOrm({ url }) needs Bun. Pass { client } instead, e.g. fromNodeSqlite(db)",
    );
  }

  if (adapter === "postgres") {
    return new Bun.SQL(url, { adapter, ...pool });
  }

  return new Bun.SQL(url, { adapter });
};

export const getOrmConnectionUrl = (client: object) => {
  return connectionUrls.get(client);
};

export class Orm<T extends Record<string, Table>, R extends RelationsFor<T>> {
  public readonly $raw: SqlClient;
  private options: CreateOrmOptions<T, R>;
  private tableRelationsMap = new Map<Table, TableRelations>();

  public constructor(options: CreateOrmOptions<T, R>) {
    this.options = options;

    if (options.client) {
      this.$raw = options.client;
      return;
    }

    this.$raw = openBunSql(options.adapter, options.url, options.pool);
  }

  public buildClient(): OrmClient<T, R> {
    const tableClients = this.buildTableClients(this.$raw);
    const transaction = this.buildTransaction();

    let pool: OrmPoolOptions | undefined;

    if (this.options.adapter === "postgres") {
      pool = this.options.pool;
    }

    const client = {
      ...tableClients,
      $raw: this.$raw,
      $config: {
        adapter: this.options.adapter,
        url: redactDatabaseUrl(this.options.url),
        tables: this.options.tables,
        pool,
      },
      $transaction: transaction,
      $ping: () => this.ping(),
    };

    connectionUrls.set(client, this.options.url);

    return client;
  }

  private buildTableClients(sql: Sql): OrmTableClients<T, R> {
    const clients = Object.create(null);

    for (const entry of this.toObjectEntries(this.options.tables)) {
      this.setTableClient(clients, sql, entry[0], entry[1]);
    }

    return clients;
  }

  private setTableClient<K extends StringKeyOf<T>>(
    clients: OrmTableClients<T, R>,
    sql: Sql,
    tableName: K,
    table: T[K],
  ) {
    const tableRelations = this.getTableRelations(tableName);
    let globalHooks: ReturnType<typeof pickGlobalHooks> | undefined;

    if (this.options.hooks) {
      globalHooks = pickGlobalHooks(this.options.hooks);
    }

    this.tableRelationsMap.set(table, tableRelations);
    clients[tableName] = new TableClientImpl<T[K], TableRelationsFor<R, K>>({
      sql,
      tableName,
      table,
      adapter: this.options.adapter,
      // @ts-expect-error TableRelationsFor and NonNullable<R[K]> are equivalent here
      relations: tableRelations,
      tableRelationsMap: this.tableRelationsMap,
      globalHooks,
      tableHooks: this.options.hooks?.tables?.[tableName],
    });
  }

  private buildTransaction() {
    return async <TResult>(
      callback: (tx: TransactionClient<T, R>) => Promise<TResult>,
    ): Promise<TResult> => {
      const run = async (txSql: SqlTransaction) => {
        const txTableClients = this.buildTableClients(txSql);
        const txClient: TransactionClient<T, R> = {
          ...txTableClients,
          $raw: txSql,
        };

        return await callback(txClient);
      };

      return await getDialectSpec(this.options.adapter).begin(this.$raw, run);
    };
  }

  private async ping() {
    await this.$raw.unsafe("SELECT 1");
  }

  private getTableRelations<K extends StringKeyOf<T>>(
    tableName: K,
  ): NonNullable<R[K]> {
    const tableRelations = this.options.relations?.[tableName];

    if (!tableRelations) {
      return Object.create(null);
    }

    return tableRelations;
  }

  private toObjectEntries<TObject extends object>(
    object: TObject,
  ): ObjectEntries<TObject> {
    const result: ObjectEntries<TObject> = [];

    for (const key in object) {
      if (!Object.hasOwn(object, key)) {
        continue;
      }

      result.push([key, object[key]]);
    }

    return result;
  }
}

export const createOrm = <
  const T extends Record<string, Table>,
  const R extends RelationsFor<T>,
>(
  options: CreateOrmOptions<T, R>,
) => new Orm(options).buildClient();

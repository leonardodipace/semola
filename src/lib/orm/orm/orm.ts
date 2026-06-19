import type { Table } from "../table/types.js";
import { pickGlobalHooks } from "./hook-runner.js";
import { TableClientImpl } from "./table-client.js";
import type {
  CreateOrmOptions,
  ObjectEntries,
  OrmClient,
  OrmTableClients,
  RelationsFor,
  StringKeyOf,
  TableRelations,
  TableRelationsFor,
  TransactionClient,
} from "./types.js";

export class Orm<T extends Record<string, Table>, R extends RelationsFor<T>> {
  public readonly $raw: Bun.SQL;
  private options: CreateOrmOptions<T, R>;
  private tableRelationsMap = new Map<Table, TableRelations>();

  public constructor(options: CreateOrmOptions<T, R>) {
    this.options = options;
    this.$raw = new Bun.SQL(options.url, {
      adapter: options.adapter,
    });
  }

  public buildClient(): OrmClient<T, R> {
    const tableClients = this.buildTableClients(this.$raw);
    const transaction = this.buildTransaction();

    return {
      ...tableClients,
      $raw: this.$raw,
      $transaction: transaction,
    };
  }

  private buildTableClients(sql: Bun.SQL): OrmTableClients<T, R> {
    const clients = Object.create(null);

    for (const entry of this.toObjectEntries(this.options.tables)) {
      this.setTableClient(clients, sql, entry[0], entry[1]);
    }

    return clients;
  }

  private setTableClient<K extends StringKeyOf<T>>(
    clients: OrmTableClients<T, R>,
    sql: Bun.SQL,
    tableName: K,
    table: T[K],
  ) {
    const tableRelations = this.getTableRelations(tableName);

    this.tableRelationsMap.set(table, tableRelations);
    clients[tableName] = new TableClientImpl<T[K], TableRelationsFor<R, K>>({
      sql,
      tableName,
      table,
      adapter: this.options.adapter,
      // @ts-expect-error TableRelationsFor and NonNullable<R[K]> are equivalent here
      relations: tableRelations,
      tableRelationsMap: this.tableRelationsMap,
      globalHooks: this.options.hooks
        ? pickGlobalHooks(this.options.hooks)
        : undefined,
      tableHooks: this.options.hooks?.tables?.[tableName],
    });
  }

  private buildTransaction() {
    return async <TResult>(
      callback: (tx: TransactionClient<T, R>) => Promise<TResult>,
    ): Promise<TResult> => {
      return await this.$raw.begin(async (txSql) => {
        const txTableClients = this.buildTableClients(txSql);
        const txClient: TransactionClient<T, R> = {
          ...txTableClients,
          $raw: txSql,
        };

        return await callback(txClient);
      });
    };
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

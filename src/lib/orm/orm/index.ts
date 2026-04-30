import type { Adapter } from "../dialect/index.js";
import { getDialect } from "../dialect/index.js";
import type { Table } from "../table/types.js";
import type { CreateOrmOptions, OrmClient, TableClient } from "./types.js";

const createTableClient = <T extends Table>(
  sql: Bun.SQL,
  table: T,
  adapter: Adapter,
): TableClient<T> => {
  const dialect = getDialect(adapter, table);

  return {
    findMany: async () => {
      return await dialect.findMany(sql);
    },
  };
};

export const createOrm = <const T extends Record<string, Table>>(
  options: CreateOrmOptions<T>,
) => {
  const sql = new Bun.SQL({
    url: options.url,
    adapter: options.adapter,
  });

  const resultEntries = Object.entries(options.tables).map(
    ([tableName, table]) => {
      return [tableName, createTableClient(sql, table, options.adapter)];
    },
  );

  const orm = Object.fromEntries(resultEntries) as OrmClient<T>;

  orm.$raw = sql;

  return orm;
};

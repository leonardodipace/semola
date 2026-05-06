import type { Adapter } from "../dialect/index.js";
import { getDialect } from "../dialect/index.js";
import type { Table } from "../table/types.js";
import type {
  CreateOrmOptions,
  FindManyOptions,
  HasMany,
  HasOne,
  OrmClient,
  Relations,
  TableClient,
} from "./types.js";

export const many = <T extends Table>(table: () => T): HasMany<T> => {
  return {
    _type: "hasMany",
    _table: table(),
  };
};

export const one = <T extends Table>(table: () => T): HasOne<T> => {
  return {
    _type: "hasOne",
    _table: table(),
  };
};

const createTableClient = <T extends Table>(
  sql: Bun.SQL,
  table: T,
  adapter: Adapter,
): TableClient<T> => {
  const dialect = getDialect(adapter, table);

  return {
    findMany: async <const TOptions extends FindManyOptions<T>>(
      options?: TOptions,
    ) => {
      return await dialect.findMany(sql, options);
    },
  };
};

export const createOrm = <
  const T extends Record<string, Table>,
  const R extends Relations,
>(
  options: CreateOrmOptions<T, R>,
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

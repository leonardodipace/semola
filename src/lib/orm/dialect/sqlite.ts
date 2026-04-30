import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import type { Dialect } from "./types.js";

export const createSqliteDialect = <T extends Table>(table: T): Dialect<T> => {
  return {
    name: "sqlite",
    findMany: async (sql: Bun.SQL) => {
      const tableName = sql(table.sqlName);
      const columns = Object.keys(table.columns).map(quoteIdentifier);

      return await sql`SELECT ${columns} FROM ${tableName}`;
    },
  };
};

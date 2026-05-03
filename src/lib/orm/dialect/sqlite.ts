import type { Table } from "../table/types.js";
import type { Dialect } from "./types.js";

export const createSqliteDialect = <T extends Table>(table: T): Dialect<T> => {
  return {
    name: "sqlite",
    findMany: async (sql: Bun.SQL) => {
      return await sql`SELECT * FROM ${sql(table.sqlName)}`;
    },
  };
};

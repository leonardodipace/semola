import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { createSqliteDialect } from "./sqlite.js";
import type { Adapter, Dialect } from "./types.js";

export const getDialect = <T extends Table, R extends TableRelations>(
  adapter: Adapter,
  table: T,
  relations: R,
): Dialect<T, R> => {
  switch (adapter) {
    case "sqlite":
      return createSqliteDialect(table, relations);
    default:
      throw new Error(`Unsupported adapter: ${adapter}`);
  }
};

export type { Adapter, Dialect };

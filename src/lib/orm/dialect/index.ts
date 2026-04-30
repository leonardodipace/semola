import type { Table } from "../table/types.js";
import { createSqliteDialect } from "./sqlite.js";
import type { Adapter, Dialect } from "./types.js";

export const getDialect = <T extends Table>(
  adapter: Adapter,
  table: T,
): Dialect<T> => {
  switch (adapter) {
    case "sqlite":
      return createSqliteDialect(table);
    default:
      throw new Error(`Unsupported adapter: ${adapter}`);
  }
};

export type { Adapter, Dialect };

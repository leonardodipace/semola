import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { createPostgresDialect } from "./postgres.js";
import { createSqliteDialect } from "./sqlite.js";
import type { Adapter, Dialect, GetDialectInput } from "./types.js";

export const getDialect = <T extends Table, R extends TableRelations>(
  input: GetDialectInput<T, R>,
): Dialect<T, R> => {
  const { adapter, table, relations, tableRelationsMap = new Map() } = input;

  switch (adapter) {
    case "sqlite":
      return createSqliteDialect({ table, relations, tableRelationsMap });
    case "postgres":
      return createPostgresDialect({ table, relations, tableRelationsMap });
    default:
      throw new Error(`Unsupported adapter: ${adapter}`);
  }
};

export type { Adapter, Dialect };

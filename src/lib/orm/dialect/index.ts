import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { SqlDialect } from "./dialect.js";
import { POSTGRES_SPEC } from "./postgres.js";
import { SQLITE_SPEC } from "./sqlite.js";
import type { Adapter, Dialect, GetDialectInput } from "./types.js";

export const getDialect = <T extends Table, R extends TableRelations>(
  input: GetDialectInput<T, R>,
): Dialect<T, R> => {
  const dialectInput = {
    ...input,
    tableRelationsMap: input.tableRelationsMap ?? new Map(),
  };

  switch (input.adapter) {
    case "sqlite":
      return new SqlDialect({ spec: SQLITE_SPEC, ...dialectInput });
    case "postgres":
      return new SqlDialect({ spec: POSTGRES_SPEC, ...dialectInput });
    default:
      throw new Error(`Unsupported adapter: ${input.adapter}`);
  }
};

export type { Adapter, Dialect };

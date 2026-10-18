import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { SqlDialect } from "./dialect.js";
import { POSTGRES_SPEC } from "./postgres.js";
import { SQLITE_SPEC } from "./sqlite.js";
import type {
  Adapter,
  Dialect,
  DialectSpec,
  GetDialectInput,
} from "./types.js";

export const getDialectSpec = (adapter: Adapter): DialectSpec => {
  switch (adapter) {
    case "sqlite":
      return SQLITE_SPEC;
    case "postgres":
      return POSTGRES_SPEC;
    default:
      throw new Error(`Unsupported adapter: ${adapter}`);
  }
};

export const getDialect = <T extends Table, R extends TableRelations>(
  input: GetDialectInput<T, R>,
): Dialect<T, R> => {
  return new SqlDialect({
    spec: getDialectSpec(input.adapter),
    table: input.table,
    relations: input.relations,
    tableRelationsMap: input.tableRelationsMap ?? new Map(),
  });
};

export type { Adapter, Dialect };

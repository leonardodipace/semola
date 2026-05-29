import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { createDialect, type DialectSpec } from "./shared.js";

export const POSTGRES_SPEC: DialectSpec = {
  name: "postgres",
  formatPlaceholder: (index) => `$${index}`,
  unlimitedOffsetKeyword: "LIMIT ALL OFFSET",
  jsonObjectFunctionName: "jsonb_build_object",
  jsonArrayAggregateFunctionName: "jsonb_agg",
  emptyJsonArrayLiteral: "'[]'::jsonb",
};

export const createPostgresDialect = <
  T extends Table,
  R extends TableRelations,
>(
  table: T,
  relations: R,
) => createDialect(POSTGRES_SPEC, table, relations);

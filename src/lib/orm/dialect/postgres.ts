import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { createDialect } from "./shared.js";
import type { CreateNamedDialectInput, DialectSpec } from "./types.js";

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
  input: CreateNamedDialectInput<T, R>,
) => createDialect({ spec: POSTGRES_SPEC, ...input });

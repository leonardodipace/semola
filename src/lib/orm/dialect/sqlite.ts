import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { createDialect, type DialectSpec } from "./shared.js";

export const SQLITE_SPEC: DialectSpec = {
  name: "sqlite",
  formatPlaceholder: () => "?",
  unlimitedOffsetKeyword: "LIMIT -1 OFFSET",
  jsonObjectFunctionName: "json_object",
  jsonArrayAggregateFunctionName: "json_group_array",
  emptyJsonArrayLiteral: "'[]'",
};

export const createSqliteDialect = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
) => createDialect(SQLITE_SPEC, table, relations);

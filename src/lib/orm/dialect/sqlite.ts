import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { createDialect } from "./shared.js";
import type {
  CreateNamedDialectInput,
  DialectSpec,
  IsolationLevel,
} from "./types.js";

export const SQLITE_SPEC: DialectSpec = {
  name: "sqlite",
  formatPlaceholder: () => "?",
  unlimitedOffsetKeyword: "LIMIT -1 OFFSET",
  jsonObjectFunctionName: "json_object",
  jsonArrayAggregateFunctionName: "json_group_array",
  emptyJsonArrayLiteral: "'[]'",
  formatIsolationLevel: (level: IsolationLevel) => {
    if (level === "Serializable") {
      return "";
    }

    return null;
  },
};

export const createSqliteDialect = <T extends Table, R extends TableRelations>(
  input: CreateNamedDialectInput<T, R>,
) => createDialect({ spec: SQLITE_SPEC, ...input });

import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { createDialect } from "./shared.js";
import type {
  CreateNamedDialectInput,
  DialectSpec,
  IsolationLevel,
} from "./types.js";

export const POSTGRES_SPEC: DialectSpec = {
  name: "postgres",
  formatPlaceholder: (index) => `$${index}`,
  unlimitedOffsetKeyword: "LIMIT ALL OFFSET",
  jsonObjectFunctionName: "jsonb_build_object",
  jsonArrayAggregateFunctionName: "jsonb_agg",
  emptyJsonArrayLiteral: "'[]'::jsonb",
  formatIsolationLevel: (level: IsolationLevel) => {
    switch (level) {
      case "ReadUncommitted":
        return "ISOLATION LEVEL READ UNCOMMITTED";
      case "ReadCommitted":
        return "ISOLATION LEVEL READ COMMITTED";
      case "RepeatableRead":
        return "ISOLATION LEVEL REPEATABLE READ";
      case "Serializable":
        return "ISOLATION LEVEL SERIALIZABLE";
    }
  },
};

export const createPostgresDialect = <
  T extends Table,
  R extends TableRelations,
>(
  input: CreateNamedDialectInput<T, R>,
) => createDialect({ spec: POSTGRES_SPEC, ...input });

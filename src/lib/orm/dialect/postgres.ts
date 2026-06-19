import type { DialectSpec } from "./types.js";

export const POSTGRES_SPEC: DialectSpec = {
  name: "postgres",
  formatPlaceholder: (index) => `$${index}`,
  unlimitedOffsetKeyword: "LIMIT ALL OFFSET",
  jsonObjectFunctionName: "jsonb_build_object",
  jsonArrayAggregateFunctionName: "jsonb_agg",
  emptyJsonArrayLiteral: "'[]'::jsonb",
};

import type { DialectSpec } from "./types.js";

export const SQLITE_SPEC: DialectSpec = {
  name: "sqlite",
  formatPlaceholder: () => "?",
  unlimitedOffsetKeyword: "LIMIT -1 OFFSET",
  jsonObjectFunctionName: "json_object",
  jsonArrayAggregateFunctionName: "json_group_array",
  emptyJsonArrayLiteral: "'[]'",
};

const sqliteForeignKeysOn = new WeakMap<Bun.SQL, Promise<unknown>>();

export const enableSqliteForeignKeys = (sql: Bun.SQL) => {
  const pending = sqliteForeignKeysOn.get(sql);

  if (pending) return pending;

  const next = sql.unsafe("PRAGMA foreign_keys = ON");
  sqliteForeignKeysOn.set(sql, next);

  return next;
};

import { AsyncLocalStorage } from "node:async_hooks";
import type { DialectSpec } from "./types.js";

export const SQLITE_SPEC: DialectSpec = {
  name: "sqlite",
  formatPlaceholder: () => "?",
  unlimitedOffsetKeyword: "LIMIT -1 OFFSET",
  jsonObjectFunctionName: "json_object",
  jsonArrayAggregateFunctionName: "json_group_array",
  emptyJsonArrayLiteral: "'[]'",
  formatDistinct: (quotedColumns) => ({
    selectPrefix: "",
    groupBy: quotedColumns.join(", "),
    requiresOrderByPrefix: false,
  }),
};

const sqliteForeignKeysOn = new WeakMap<Bun.SQL, Promise<unknown>>();

export const enableSqliteForeignKeys = (sql: Bun.SQL) => {
  const pending = sqliteForeignKeysOn.get(sql);

  if (pending) return pending;

  const next = sql.unsafe("PRAGMA foreign_keys = ON");
  sqliteForeignKeysOn.set(sql, next);

  return next;
};

// ponytail: one writer per SQLite connection; queue begins instead of failing
const sqliteBeginTail = new WeakMap<Bun.SQL, Promise<unknown>>();
const sqliteBeginContext = new AsyncLocalStorage<Set<Bun.SQL>>();

export const beginSqlite = <TResult>(
  sql: Bun.SQL,
  run: (tx: Bun.TransactionSQL) => Promise<TResult>,
) => {
  if (sqliteBeginContext.getStore()?.has(sql)) {
    return sql.begin(run);
  }

  const previous = sqliteBeginTail.get(sql) ?? Promise.resolve();

  const start = () => {
    const active = sqliteBeginContext.getStore();
    const nextActive = new Set(active);
    nextActive.add(sql);

    return sqliteBeginContext.run(nextActive, () => sql.begin(run));
  };

  const next = previous.then(start, start);

  sqliteBeginTail.set(
    sql,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );

  return next;
};

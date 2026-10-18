import { AsyncLocalStorage } from "node:async_hooks";
import type { DialectSpec, DialectTransactionFn } from "./types.js";

const sqliteForeignKeysOn = new WeakMap<Bun.SQL, Promise<unknown>>();

const enableSqliteForeignKeys = (sql: Bun.SQL) => {
  const pending = sqliteForeignKeysOn.get(sql);

  if (pending) return pending;

  const next = sql.unsafe("PRAGMA foreign_keys = ON");
  sqliteForeignKeysOn.set(sql, next);

  return next;
};

const sqliteBeginTail = new WeakMap<Bun.SQL, Promise<unknown>>();
const sqliteActiveToken = new WeakMap<Bun.SQL, object>();
const sqliteBeginContext = new AsyncLocalStorage<Map<Bun.SQL, object>>();

const isNestedInActiveBegin = (sql: Bun.SQL) => {
  const store = sqliteBeginContext.getStore();

  if (!store) return false;

  const activeToken = sqliteActiveToken.get(sql);

  if (!activeToken) return false;

  return store.get(sql) === activeToken;
};

export const beginSqlite = <TResult>(
  sql: Bun.SQL,
  run: DialectTransactionFn<TResult>,
) => {
  if (isNestedInActiveBegin(sql)) {
    return sql.begin(run);
  }

  const previous = sqliteBeginTail.get(sql) ?? Promise.resolve();

  const start = async () => {
    const token = {};
    sqliteActiveToken.set(sql, token);

    const nextActive = new Map(sqliteBeginContext.getStore());
    nextActive.set(sql, token);

    try {
      return await sqliteBeginContext.run(nextActive, () => sql.begin(run));
    } finally {
      if (sqliteActiveToken.get(sql) === token) {
        sqliteActiveToken.delete(sql);
      }
    }
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
  prepareConnection: enableSqliteForeignKeys,
  begin: async (sql, run) => {
    await enableSqliteForeignKeys(sql);

    return beginSqlite(sql, run);
  },
};

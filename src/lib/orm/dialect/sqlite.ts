import { AsyncLocalStorage } from "node:async_hooks";
import type { Sql, SqlClient } from "../types.js";
import type { DialectSpec, DialectTransactionFn } from "./types.js";

const sqliteForeignKeysOn = new WeakMap<Sql, Promise<unknown>>();

const enableSqliteForeignKeys = (sql: Sql) => {
  const pending = sqliteForeignKeysOn.get(sql);

  if (pending) return pending;

  const next = sql.unsafe("PRAGMA foreign_keys = ON");
  sqliteForeignKeysOn.set(sql, next);

  return next;
};

const sqliteBeginTail = new WeakMap<SqlClient, Promise<unknown>>();
const sqliteActiveToken = new WeakMap<SqlClient, object>();
const sqliteBeginContext = new AsyncLocalStorage<Map<SqlClient, object>>();

const isNestedInActiveBegin = (sql: SqlClient) => {
  const store = sqliteBeginContext.getStore();

  if (!store) return false;

  const activeToken = sqliteActiveToken.get(sql);

  if (!activeToken) return false;

  return store.get(sql) === activeToken;
};

export const beginSqlite = <TResult>(
  sql: SqlClient,
  run: DialectTransactionFn<TResult>,
) => {
  if (isNestedInActiveBegin(sql)) {
    // Bun.SQL nested begin hangs instead of rejecting; fail here.
    return Promise.reject(
      new Error("cannot start a transaction within a transaction"),
    );
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

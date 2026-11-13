import { AsyncLocalStorage } from "node:async_hooks";
import type { Sql, SqlClient } from "../types.js";
import type { DialectSpec, DialectTransactionFn } from "./types.js";

const sqliteForeignKeysOn = new WeakMap<Sql, Promise<unknown>>();

const enableSqliteForeignKeys = (sql: Sql) => {
  const pending = sqliteForeignKeysOn.get(sql);

  if (pending) return pending;

  const enable = async () => {
    await sql.unsafe("PRAGMA foreign_keys = ON");

    const [row] = await sql.unsafe("PRAGMA foreign_keys");

    // Ignored inside an open transaction; try again on the next query.
    if (row?.foreign_keys !== 1) sqliteForeignKeysOn.delete(sql);
  };

  const next = enable();
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
  if (sql.queuesTransactions) return sql.begin(run);

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

// CURRENT_TIMESTAMP writes "YYYY-MM-DD HH:MM:SS", but the ORM binds dates as
// ISO strings; SQLite compares them as text, so where filters would miss rows.
const ISO_CURRENT_TIMESTAMP = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const ISO_CURRENT_DATE = "(strftime('%Y-%m-%dT00:00:00.000Z', 'now'))";
const CURRENT_TIMESTAMP = /^\(?\s*CURRENT_TIMESTAMP\s*\)?$/i;
const CURRENT_DATE = /^\(?\s*CURRENT_DATE\s*\)?$/i;

export const formatSqliteDbDefault = (value: string) => {
  if (CURRENT_TIMESTAMP.test(value)) return ISO_CURRENT_TIMESTAMP;
  if (CURRENT_DATE.test(value)) return ISO_CURRENT_DATE;

  // SQLite DDL only takes a function call default inside parentheses.
  if (value.startsWith("(")) return value;
  if (!value.includes("(")) return value;

  return `(${value})`;
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
  formatDbDefault: formatSqliteDbDefault,
  begin: async (sql, run) => {
    await enableSqliteForeignKeys(sql);

    return beginSqlite(sql, run);
  },
};

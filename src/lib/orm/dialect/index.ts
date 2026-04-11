import type { Dialect, DialectAdapter } from "../types.js";
import { mysqlDialectAdapter } from "./mysql.js";
import { postgresDialectAdapter } from "./postgres.js";
import { sqliteDialectAdapter } from "./sqlite.js";

const dialectAdapters = {
  postgres: postgresDialectAdapter,
  mysql: mysqlDialectAdapter,
  sqlite: sqliteDialectAdapter,
} satisfies Record<Dialect, DialectAdapter>;

export function getDialectAdapter(dialect: Dialect): DialectAdapter {
  return dialectAdapters[dialect];
}

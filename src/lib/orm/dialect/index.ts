import type { Dialect, DialectAdapter } from "../types.js";
import { mysqlDialectAdapter } from "./mysql.js";
import { postgresDialectAdapter } from "./postgres.js";
import { sqliteDialectAdapter } from "./sqlite.js";

export function getDialectAdapter(dialect: Dialect): DialectAdapter {
  if (dialect === "postgres") {
    return postgresDialectAdapter;
  }

  if (dialect === "mysql") {
    return mysqlDialectAdapter;
  }

  return sqliteDialectAdapter;
}

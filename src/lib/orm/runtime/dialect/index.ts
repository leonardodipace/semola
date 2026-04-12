import type { ColDefs, Dialect, RelationDefs } from "../../types.js";
import type { DialectOptions } from "./base.js";
import { MysqlDialect } from "./mysql.js";
import { PostgresDialect } from "./postgres.js";
import { SqliteDialect } from "./sqlite.js";

export function createRuntimeDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
>(options: DialectOptions<T, TRels> & { dialect: Dialect }) {
  if (options.dialect === "postgres") {
    return new PostgresDialect<T, TRels>(options);
  }

  if (options.dialect === "mysql") {
    return new MysqlDialect<T, TRels>(options);
  }

  return new SqliteDialect<T, TRels>(options);
}

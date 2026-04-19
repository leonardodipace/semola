import type { ColDefs, Dialect, RelationDefs } from "../../types.js";
import { createMysqlRuntimeDialect } from "./mysql.js";
import { createPostgresRuntimeDialect } from "./postgres.js";
import { createSqliteRuntimeDialect } from "./sqlite.js";

export function getRuntimeDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
>(dialect: Dialect) {
  if (dialect === "postgres") {
    return createPostgresRuntimeDialect<T, TRels>();
  }

  if (dialect === "mysql") {
    return createMysqlRuntimeDialect<T, TRels>();
  }

  return createSqliteRuntimeDialect<T, TRels>();
}

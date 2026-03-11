import type { SQL } from "bun";
import { err } from "../../errors/index.js";
import type { Dialect } from "../types.js";
import { introspectMysql } from "./mysql.js";
import { introspectPostgres } from "./postgres.js";
import { introspectSqlite } from "./sqlite.js";

export { generateCode } from "./codegen.js";
export type {
  IntrospectedColumn,
  IntrospectedTable,
  OnDeleteAction,
} from "./types.js";

export async function introspectSchema(
  sql: SQL,
  dialect: Dialect,
  options?: { schema?: string },
) {
  if (dialect === "postgres") {
    return introspectPostgres(sql, options?.schema ?? "public");
  }

  if (dialect === "sqlite") {
    return introspectSqlite(sql);
  }

  if (dialect === "mysql") {
    const schema = options?.schema;

    if (!schema) {
      return err("IntrospectError", "schema name is required for MySQL");
    }

    return introspectMysql(sql, schema);
  }

  return err("IntrospectError", `unknown dialect: ${dialect}`);
}

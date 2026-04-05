import type { SQL } from "bun";
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

async function unwrapIntrospection(
  resultPromise:
    | ReturnType<typeof introspectPostgres>
    | ReturnType<typeof introspectSqlite>
    | ReturnType<typeof introspectMysql>,
) {
  const [error, data] = await resultPromise;

  if (error) {
    throw new Error(error.message);
  }

  if (data === null) {
    throw new Error("Introspection returned no data");
  }

  return data;
}

export async function introspectSchema(
  sql: SQL,
  dialect: Dialect,
  options?: { schema?: string },
) {
  if (dialect === "postgres") {
    return unwrapIntrospection(
      introspectPostgres(sql, options?.schema ?? "public"),
    );
  }

  if (dialect === "sqlite") {
    return unwrapIntrospection(introspectSqlite(sql));
  }

  if (dialect === "mysql") {
    const schema = options?.schema;

    if (!schema) {
      throw new Error("schema name is required for MySQL");
    }

    return unwrapIntrospection(introspectMysql(sql, schema));
  }

  throw new Error(`unknown dialect: ${dialect}`);
}

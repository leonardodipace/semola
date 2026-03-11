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

export async function introspectSchema(
  sql: SQL,
  dialect: Dialect,
  options?: { schema?: string },
) {
  if (dialect === "postgres") {
    const [error, data] = await introspectPostgres(
      sql,
      options?.schema ?? "public",
    );

    if (error) {
      throw new Error(error.message);
    }

    if (data === null) {
      throw new Error("Introspection returned no data");
    }

    return data;
  }

  if (dialect === "sqlite") {
    const [error, data] = await introspectSqlite(sql);

    if (error) {
      throw new Error(error.message);
    }

    if (data === null) {
      throw new Error("Introspection returned no data");
    }

    return data;
  }

  if (dialect === "mysql") {
    const schema = options?.schema;

    if (!schema) {
      throw new Error("schema name is required for MySQL");
    }

    const [error, data] = await introspectMysql(sql, schema);

    if (error) {
      throw new Error(error.message);
    }

    if (data === null) {
      throw new Error("Introspection returned no data");
    }

    return data;
  }

  throw new Error(`unknown dialect: ${dialect}`);
}

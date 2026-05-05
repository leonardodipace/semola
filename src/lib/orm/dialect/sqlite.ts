import type { Column } from "../column/types.js";
import type { TableWhere } from "../orm/types.js";
import type { Table } from "../table/types.js";
import type { Dialect } from "./types.js";

const quoteIdentifier = (name: string) => {
  return `"${name}"`;
};

type WhereClause = {
  sql: string;
  params: unknown[];
};

const buildWhereClause = <T extends Table>(
  table: T,
  where?: TableWhere<T>,
): WhereClause => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!where) return { sql: "", params };

  const entries = Object.entries(where);

  for (const entry of entries) {
    const [jsKey, value] = entry;
    const typedKey = jsKey as keyof T["columns"];

    const column = table.columns[typedKey] as Column;
    const sqlName = table.columns[typedKey].sqlName;
    const columnName = quoteIdentifier(sqlName);

    if (column.type === "string") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ?`);
        params.push(value.eq);
      }

      if ("startsWith" in value) {
        clauses.push(`${columnName} LIKE ?`);
        params.push(`${value.startsWith}%`);
      }

      if ("endsWith" in value) {
        clauses.push(`${columnName} LIKE ?`);
        params.push(`%${value.endsWith}`);
      }

      if ("contains" in value) {
        clauses.push(`${columnName} LIKE ?`);
        params.push(`%${value.contains}%`);
      }
    }

    if (column.type === "number") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ?`);
        params.push(value.eq);
      }

      if ("gt" in value) {
        clauses.push(`${columnName} > ?`);
        params.push(value.gt);
      }

      if ("gte" in value) {
        clauses.push(`${columnName} >= ?`);
        params.push(value.gte);
      }

      if ("lt" in value) {
        clauses.push(`${columnName} < ?`);
        params.push(value.lt);
      }

      if ("lte" in value) {
        clauses.push(`${columnName} <= ?`);
        params.push(value.lte);
      }
    }

    if (column.type === "boolean") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ?`);
        params.push(value.eq);
      }
    }

    if (column.type === "date") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ?`);
        params.push(value.eq);
      }

      if ("gt" in value) {
        clauses.push(`${columnName} > ?`);
        params.push(value.gt);
      }

      if ("gte" in value) {
        clauses.push(`${columnName} >= ?`);
        params.push(value.gte);
      }

      if ("lt" in value) {
        clauses.push(`${columnName} < ?`);
        params.push(value.lt);
      }

      if ("lte" in value) {
        clauses.push(`${columnName} <= ?`);
        params.push(value.lte);
      }
    }
  }

  return { sql: clauses.join(" AND "), params };
};

const buildSelectStatement = (tableName: string, where: string) => {
  const base = `SELECT * FROM ${quoteIdentifier(tableName)}`;

  if (!where) return base;

  return `${base} WHERE ${where}`;
};

export const createSqliteDialect = <T extends Table>(table: T): Dialect<T> => {
  return {
    name: "sqlite",
    findMany: async (sql, options) => {
      const where = buildWhereClause(table, options?.where);
      const statement = buildSelectStatement(table.sqlName, where.sql);

      console.log(statement, where.params);

      return await sql.unsafe(statement, where.params);
    },
  };
};

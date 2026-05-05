import type { Column } from "../column/types.js";
import type { TableWhere } from "../orm/types.js";
import type { Table } from "../table/types.js";
import type { Dialect } from "./types.js";

const quoteIdentifier = (name: string) => {
  return `"${name}"`;
};

const quoteValue = (value: unknown) => {
  return `'${value}'`;
};

const buildWhereClause = <T extends Table>(table: T, where?: TableWhere<T>) => {
  const clauses: string[] = ["1 = 1"];

  if (!where) return clauses.join(" AND ");

  const entries = Object.entries(where);

  for (const entry of entries) {
    const [jsKey, value] = entry;
    const typedKey = jsKey as keyof T["columns"];

    const column = table.columns[typedKey] as Column;
    const sqlName = table.columns[typedKey].sqlName;
    const columnName = quoteIdentifier(sqlName);
    const val = quoteValue(value.eq);

    if (column.type === "string") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ${val}`);
      }

      if ("startsWith" in value) {
        clauses.push(`${columnName} LIKE ${quoteValue(value.startsWith)}%`);
      }

      if ("endsWith" in value) {
        clauses.push(`${columnName} LIKE %${quoteValue(value.endsWith)}`);
      }

      if ("contains" in value) {
        clauses.push(`${columnName} LIKE %${quoteValue(value.contains)}%`);
      }
    }

    if (column.type === "number") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ${val}`);
      }

      if ("gt" in value) {
        clauses.push(`${columnName} > ${val}`);
      }

      if ("gte" in value) {
        clauses.push(`${columnName} >= ${val}`);
      }

      if ("lt" in value) {
        clauses.push(`${columnName} < ${val}`);
      }

      if ("lte" in value) {
        clauses.push(`${columnName} <= ${val}`);
      }
    }

    if (column.type === "boolean") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ${val}`);
      }
    }

    if (column.type === "date") {
      if ("eq" in value) {
        clauses.push(`${columnName} = ${val}`);
      }

      if ("gt" in value) {
        clauses.push(`${columnName} > ${val}`);
      }

      if ("gte" in value) {
        clauses.push(`${columnName} >= ${val}`);
      }

      if ("lt" in value) {
        clauses.push(`${columnName} < ${val}`);
      }

      if ("lte" in value) {
        clauses.push(`${columnName} <= ${val}`);
      }
    }
  }

  return clauses.join(" AND ");
};

const buildSelectStatement = (tableName: string, where?: string) => {
  return `SELECT * FROM ${quoteIdentifier(tableName)} WHERE ${where}`;
};

export const createSqliteDialect = <T extends Table>(table: T): Dialect<T> => {
  return {
    name: "sqlite",
    findMany: async (sql, options) => {
      const where = buildWhereClause(table, options?.where);
      const statement = buildSelectStatement(table.sqlName, where);

      return await sql.unsafe(statement);
    },
  };
};

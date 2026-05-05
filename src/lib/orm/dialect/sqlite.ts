import type { TableOrderBy, TableSelect, TableWhere } from "../orm/types.js";
import type { Table } from "../table/types.js";
import type { Dialect } from "./types.js";

type WhereClause = {
  sql: string;
  params: unknown[];
};

const OPERATORS = {
  eq: { sql: "= ?", transform: (v: unknown) => v },
  gt: { sql: "> ?", transform: (v: unknown) => v },
  gte: { sql: ">= ?", transform: (v: unknown) => v },
  lt: { sql: "< ?", transform: (v: unknown) => v },
  lte: { sql: "<= ?", transform: (v: unknown) => v },
  startsWith: { sql: "LIKE ?", transform: (v: unknown) => `${v}%` },
  endsWith: { sql: "LIKE ?", transform: (v: unknown) => `%${v}` },
  contains: { sql: "LIKE ?", transform: (v: unknown) => `%${v}%` },
} as const;

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

    const sqlName = table.columns[typedKey].sqlName;

    if (typeof value !== "object") {
      clauses.push(`${sqlName} = ?`);
      params.push(value);
      continue;
    }

    const entries = Object.entries(value);

    for (const entry of entries) {
      const [op, operand] = entry;
      const operator = OPERATORS[op as keyof typeof OPERATORS];

      if (!operator) continue;

      clauses.push(`${sqlName} ${operator.sql}`);
      params.push(operator.transform(operand));
    }
  }

  return { sql: clauses.join(" AND "), params };
};

const getColumnAlias = (sqlName: string, jsKey: string) => {
  return `${sqlName} AS ${jsKey}`;
};

const buildSelectColumns = <T extends Table>(
  table: T,
  select?: TableSelect<T>,
) => {
  if (!select) {
    return Object.entries(table.columns)
      .map(([k, col]) => getColumnAlias(col.sqlName, k))
      .join(", ");
  }

  const keys = Object.keys(select);

  return keys
    .flatMap((k) => {
      const sqlName = table.columns[k]?.sqlName;

      if (!sqlName) return [];

      return [getColumnAlias(sqlName, k)];
    })
    .join(", ");
};

const buildOrderByClause = <T extends Table>(
  table: T,
  orderBy?: TableOrderBy<T>,
) => {
  if (!orderBy) return "";

  const clauses: string[] = [];

  for (const [jsKey, direction] of Object.entries(orderBy)) {
    const sqlName = table.columns[jsKey as keyof T["columns"]]?.sqlName;

    if (!sqlName) continue;

    if (direction === "desc") {
      clauses.push(`${sqlName} DESC`);
      continue;
    }

    clauses.push(`${sqlName} ASC`);
  }

  if (!clauses.length) return "";

  return clauses.join(", ");
};

const buildSelectStatement = (
  tableName: string,
  columns: string,
  where: string,
  orderBy: string,
) => {
  let query = `SELECT ${columns} FROM ${tableName}`;

  if (where) query = `${query} WHERE ${where}`;

  if (orderBy) query = `${query} ORDER BY ${orderBy}`;

  return query;
};

export const createSqliteDialect = <T extends Table>(table: T): Dialect<T> => {
  return {
    name: "sqlite",
    findMany: async (sql, options) => {
      const where = buildWhereClause(table, options?.where);
      const columns = buildSelectColumns(table, options?.select);
      const orderBy = buildOrderByClause(table, options?.orderBy);
      const statement = buildSelectStatement(
        table.sqlName,
        columns,
        where.sql,
        orderBy,
      );

      console.log(statement, where.params);

      return [...(await sql.unsafe(statement, where.params))];
    },
  };
};

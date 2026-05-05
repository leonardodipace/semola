import type { TableSelect, TableWhere } from "../orm/types.js";
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

const buildSelectColumns = <T extends Table>(
  table: T,
  select?: TableSelect<T>,
) => {
  if (!select) return "*";

  const keys = Object.keys(select);

  return keys
    .flatMap((k) => {
      const sqlName = table.columns[k]?.sqlName;

      if (!sqlName) return [];

      return [sqlName];
    })
    .join(", ");
};

const buildSelectStatement = (
  tableName: string,
  columns: string,
  where: string,
) => {
  const base = `SELECT ${columns} FROM ${tableName}`;

  if (!where) return base;

  return `${base} WHERE ${where}`;
};

export const createSqliteDialect = <T extends Table>(table: T): Dialect<T> => {
  return {
    name: "sqlite",
    findMany: async (sql, options) => {
      const where = buildWhereClause(table, options?.where);
      const columns = buildSelectColumns(table, options?.select);
      const statement = buildSelectStatement(table.sqlName, columns, where.sql);

      console.log(statement, where.params);

      return [...(await sql.unsafe(statement, where.params))];
    },
  };
};

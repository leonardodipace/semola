import type { Column } from "../column/types.js";
import type { TableOrderBy, TableSelect, TableWhere } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import type {
  BuildPaginationClauseInput,
  BuildSelectStatementInput,
  BuildSetClausesInput,
  BuildWhereClauseInput,
  DialectSpec,
  IncludeClause,
  SqlFragment,
} from "./types.js";

export const createNextPlaceholder = (spec: DialectSpec) => {
  let index = 0;

  return () => {
    index += 1;

    return spec.formatPlaceholder(index);
  };
};

export const EMPTY_INCLUDE: IncludeClause = {
  sql: "",
  params: [],
  descriptors: [],
};

export const buildSelectList = (columns: string, include: IncludeClause) => {
  if (include.sql) return `${columns}, ${include.sql}`;

  return columns;
};

const serializeParam = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();

  return value;
};

export const serializeColumnValue = (column: Column, value: unknown) => {
  if (column.type !== "json" && column.type !== "jsonb")
    return serializeParam(value);
  if (value === null) return value;
  if (value === undefined) return null;

  return JSON.stringify(value);
};

const escapeLikeValue = (value: unknown) => {
  const escaped = `${serializeParam(value)}`
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");

  return serializeParam(escaped);
};

const OPERATORS = {
  equals: {
    sql: (ph: string) => `= ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  gt: {
    sql: (ph: string) => `> ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  gte: {
    sql: (ph: string) => `>= ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  lt: {
    sql: (ph: string) => `< ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  lte: {
    sql: (ph: string) => `<= ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  startsWith: {
    sql: (ph: string) => `LIKE ${ph} ESCAPE '\\'`,
    transform: (v: unknown) => serializeParam(`${escapeLikeValue(v)}%`),
  },
  endsWith: {
    sql: (ph: string) => `LIKE ${ph} ESCAPE '\\'`,
    transform: (v: unknown) => serializeParam(`%${escapeLikeValue(v)}`),
  },
  contains: {
    sql: (ph: string) => `LIKE ${ph} ESCAPE '\\'`,
    transform: (v: unknown) => serializeParam(`%${escapeLikeValue(v)}%`),
  },
} as const;

const isPlainObject = (value: unknown) => {
  if (value === null) return false;

  if (typeof value !== "object") return false;

  if (Array.isArray(value)) return false;

  if (value instanceof Date) return false;

  const prototype = Object.getPrototypeOf(value);

  if (prototype === null) return true;

  if (prototype === Object.prototype) return true;

  return false;
};

const appendDirectWhereClause = (input: {
  clauses: string[];
  params: unknown[];
  nextPlaceholder: () => string;
  column: Column;
  sqlName: string;
  value: unknown;
}) => {
  const { clauses, params, nextPlaceholder, column, sqlName, value } = input;

  if (value === null) {
    clauses.push(`${sqlName} IS NULL`);
    return;
  }

  clauses.push(`${sqlName} = ${nextPlaceholder()}`);
  params.push(serializeColumnValue(column, value));
};

const appendOperatorWhereClauses = (input: {
  clauses: string[];
  params: unknown[];
  nextPlaceholder: () => string;
  column: Column;
  sqlName: string;
  jsKey: string;
  value: Record<string, unknown>;
}) => {
  const { clauses, params, nextPlaceholder, column, sqlName, jsKey, value } =
    input;

  const entries = Object.entries(value);

  if (!entries.length) {
    throw new Error(`Missing where operator for field ${jsKey}`);
  }

  for (const [op, operand] of entries) {
    const operator = OPERATORS[op as keyof typeof OPERATORS];

    if (!operator) {
      throw new Error(`Unknown where operator: ${op} for field ${jsKey}`);
    }

    if (op === "equals" && operand === null) {
      clauses.push(`${sqlName} IS NULL`);
      continue;
    }

    clauses.push(`${sqlName} ${operator.sql(nextPlaceholder())}`);
    params.push(operator.transform(serializeColumnValue(column, operand)));
  }
};

const appendWhereClause = <T extends Table>(
  input: BuildWhereClauseInput<T> & {
    clauses: string[];
    params: unknown[];
    jsKey: string;
    value: unknown;
  },
) => {
  const { clauses, params, nextPlaceholder, table, jsKey, value } = input;

  if (!(jsKey in table.columns)) {
    throw new Error(`Unknown where key "${jsKey}" on table ${table.sqlName}`);
  }

  const column = table.columns[jsKey];

  if (!column) {
    throw new Error(`Unknown where key "${jsKey}" on table ${table.sqlName}`);
  }

  const sqlName = quoteIdentifier(column.sqlName);

  if (!isPlainObject(value)) {
    appendDirectWhereClause({
      clauses,
      params,
      nextPlaceholder,
      column,
      sqlName,
      value,
    });
    return;
  }

  appendOperatorWhereClauses({
    clauses,
    params,
    nextPlaceholder,
    column,
    sqlName,
    jsKey,
    value: value as Record<string, unknown>,
  });
};

export const buildWhereClause = <T extends Table>(
  input: BuildWhereClauseInput<T>,
): SqlFragment => {
  const { where } = input;

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!where) return { sql: "", params };

  for (const [jsKey, value] of Object.entries(where)) {
    if (value === undefined) continue;

    if (jsKey === "$or" || jsKey === "$and" || jsKey === "$not") {
      appendLogicalWhereClause({ ...input, clauses, params, jsKey, value });
      continue;
    }

    appendWhereClause({ ...input, clauses, params, jsKey, value });
  }

  return { sql: clauses.join(" AND "), params };
};

const appendLogicalWhereClause = <T extends Table>(
  input: BuildWhereClauseInput<T> & {
    clauses: string[];
    params: unknown[];
    jsKey: "$or" | "$and" | "$not";
    value: unknown;
  },
) => {
  const { clauses, jsKey } = input;

  const nestedClauses = collectLogicalWhereClauses(input);

  if (!nestedClauses.length) return;

  if (jsKey === "$not") {
    clauses.push(
      nestedClauses
        .map((nestedClause) => `NOT (${nestedClause})`)
        .join(" AND "),
    );

    return;
  }

  const operator = jsKey === "$or" ? "OR" : "AND";

  clauses.push(`(${nestedClauses.join(` ${operator} `)})`);
};

const collectLogicalWhereClauses = <T extends Table>(
  input: BuildWhereClauseInput<T> & {
    params: unknown[];
    jsKey: "$or" | "$and" | "$not";
    value: unknown;
  },
) => {
  const { params, jsKey, value } = input;

  if (jsKey === "$or" && !Array.isArray(value)) {
    throw new Error("$or where value must be an array");
  }

  const values = Array.isArray(value) ? value : [value];
  const nestedClauses: string[] = [];

  for (const nestedValue of values) {
    if (!isPlainObject(nestedValue)) {
      throw new Error(`${jsKey} where value must contain object filters`);
    }

    const nested = buildWhereClause({
      ...input,
      where: nestedValue as TableWhere<T>,
    });

    if (!nested.sql) continue;

    nestedClauses.push(`(${nested.sql})`);
    params.push(...nested.params);
  }

  return nestedClauses;
};

const getColumnAlias = (sqlName: string, jsKey: string) => {
  return `${quoteIdentifier(sqlName)} AS ${quoteIdentifier(jsKey)}`;
};

export const buildSelectColumns = <T extends Table>(
  table: T,
  select?: TableSelect<T>,
) => {
  if (!select || Object.keys(select).length === 0) {
    return Object.entries(table.columns)
      .map(([k, col]) => getColumnAlias(col.sqlName, k))
      .join(", ");
  }

  const selectedColumns: string[] = [];
  const keys = Object.keys(select);

  for (const key of keys) {
    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown select key "${key}" on table ${table.sqlName}`);
    }

    selectedColumns.push(getColumnAlias(column.sqlName, key));
  }

  return selectedColumns.join(", ");
};

export const buildOrderByClause = <T extends Table>(
  table: T,
  orderBy?: TableOrderBy<T>,
) => {
  if (!orderBy) return "";

  const clauses: string[] = [];

  for (const [jsKey, direction] of Object.entries(orderBy)) {
    const column = table.columns[jsKey];

    if (!column) {
      throw new Error(
        `Unknown orderBy key "${jsKey}" on table ${table.sqlName}`,
      );
    }

    if (direction === "desc") {
      clauses.push(`${quoteIdentifier(column.sqlName)} DESC`);
      continue;
    }

    if (direction === "asc") {
      clauses.push(`${quoteIdentifier(column.sqlName)} ASC`);
      continue;
    }

    throw new Error(
      `Unknown orderBy direction "${direction}" for key "${jsKey}" on table ${table.sqlName}`,
    );
  }

  if (!clauses.length) return "";

  return clauses.join(", ");
};

export const buildPaginationClause = (
  input: BuildPaginationClauseInput,
): SqlFragment => {
  const { spec, nextPlaceholder, take, skip } = input;

  const params: unknown[] = [];

  if (take === undefined) {
    if (skip === undefined) {
      return {
        sql: "",
        params,
      };
    }

    const skipPh = nextPlaceholder();
    params.push(skip);

    return {
      sql: `${spec.unlimitedOffsetKeyword} ${skipPh}`,
      params,
    };
  }

  const takePh = nextPlaceholder();
  params.push(take);

  if (skip === undefined) {
    return {
      sql: `LIMIT ${takePh}`,
      params,
    };
  }

  const skipPh = nextPlaceholder();
  params.push(skip);

  return {
    sql: `LIMIT ${takePh} OFFSET ${skipPh}`,
    params,
  };
};

export const buildSelectStatement = (input: BuildSelectStatementInput) => {
  const { tableName, columns, where, orderBy, pagination } = input;

  let query = `SELECT ${columns} FROM ${tableName}`;

  if (where) query = `${query} WHERE ${where}`;

  if (orderBy) query = `${query} ORDER BY ${orderBy}`;

  if (pagination) query = `${query} ${pagination}`;

  return query;
};

export const validateFindUniqueWhere = (
  table: Table,
  where: Record<string, unknown>,
) => {
  const entries = Object.entries(where).filter(
    ([, value]) => value !== undefined,
  );
  const keys = entries.map(([key]) => key);

  if (!keys.length) {
    throw new Error("findUnique requires at least one where key");
  }

  let hasUniqueKey = false;

  for (const [key] of entries) {
    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
    }

    if (column._meta.isPrimaryKey || column._meta.isUnique) {
      hasUniqueKey = true;
    }
  }

  if (!hasUniqueKey) {
    throw new Error(
      "findUnique where must include at least one unique or primary key column",
    );
  }
};

export const resolveCreateValue = (column: Column, provided: unknown) => {
  if (provided !== undefined) return provided;

  if (column._default) return column._default();

  return null;
};

export const buildSetClauses = <T extends Table>(
  input: BuildSetClausesInput<T>,
) => {
  const { nextPlaceholder, table, data } = input;

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [jsKey, value] of Object.entries(data)) {
    if (value === undefined) continue;

    const column = table.columns[jsKey];

    if (!column) continue;

    setClauses.push(
      `${quoteIdentifier(column.sqlName)} = ${nextPlaceholder()}`,
    );
    params.push(serializeColumnValue(column, value));
  }

  return { setClauses, params };
};

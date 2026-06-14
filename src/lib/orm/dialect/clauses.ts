import type { Column } from "../column/types.js";
import type {
  TableOrderBy,
  TableRelations,
  TableSelect,
  TableWhere,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import {
  resolveHasManyForeignKeyColumn,
  resolveHasOneForeignKeyColumn,
} from "./relation-fk.js";
import type {
  AppendDirectWhereClauseInput,
  AppendLogicalWhereClauseInput,
  AppendOperatorWhereClausesInput,
  AppendRelationWhereClauseInput,
  AppendWhereClauseInput,
  BuildPaginationClauseInput,
  BuildRelationForeignKeyConditionInput,
  BuildSelectStatementInput,
  BuildSetClausesInput,
  BuildWhereClauseInput,
  CollectedLogicalWhere,
  CollectLogicalWhereClausesInput,
  DialectSpec,
  IncludeClause,
  LogicalJoinOperator,
  LogicalNotOperator,
  LogicalWhereJoinKey,
  LogicalWhereKey,
  ParsedRelationFilter,
  SqlFragment,
} from "./types.js";

const FALSE_WHERE_SQL = "(1 = 0)";
const TRUE_WHERE_SQL = "(1 = 1)";
const RELATION_FILTER_KEYS = ["every", "some", "none"] as const;

export const EMPTY_INCLUDE: IncludeClause = {
  sql: "",
  params: [],
  descriptors: [],
};

const serializeParam = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();

  return value;
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

export const createNextPlaceholder = (spec: DialectSpec) => {
  let index = 0;

  return () => {
    index += 1;

    return spec.formatPlaceholder(index);
  };
};

export const buildSelectList = (columns: string, include: IncludeClause) => {
  if (include.sql) return `${columns}, ${include.sql}`;

  return columns;
};

export const serializeColumnValue = (column: Column, value: unknown) => {
  if (column.type !== "json" && column.type !== "jsonb")
    return serializeParam(value);
  if (value === null) return value;
  if (value === undefined) return null;

  return JSON.stringify(value);
};

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

const appendDirectWhereClause = (input: AppendDirectWhereClauseInput) => {
  const { clauses, params, nextPlaceholder, column, sqlName, value } = input;

  if (value === null) {
    clauses.push(`${sqlName} IS NULL`);
    return;
  }

  clauses.push(`${sqlName} = ${nextPlaceholder()}`);
  params.push(serializeColumnValue(column, value));
};

const appendOperatorWhereClauses = (input: AppendOperatorWhereClausesInput) => {
  const { clauses, params, nextPlaceholder, column, sqlName, jsKey, value } =
    input;

  const entries = Object.entries(value);

  if (!entries.length) {
    throw new Error(`Missing where operator for field ${jsKey}`);
  }

  for (const [op, operand] of entries) {
    if (op === "in" || op === "notIn") {
      if (!Array.isArray(operand)) {
        throw new Error(
          `Expected array for where operator: ${op} for field ${jsKey}`,
        );
      }

      if (op === "in" && operand.length === 0) {
        clauses.push(FALSE_WHERE_SQL);
        continue;
      }

      if (op === "notIn" && operand.length === 0) {
        continue;
      }

      const placeholders = operand.map(() => nextPlaceholder());
      const keyword = op === "in" ? "IN" : "NOT IN";

      clauses.push(`${sqlName} ${keyword} (${placeholders.join(", ")})`);

      for (const item of operand) {
        params.push(serializeColumnValue(column, item));
      }

      continue;
    }

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

const getRelationFilter = (
  relationName: string,
  value: unknown,
): ParsedRelationFilter => {
  if (!isPlainObject(value)) {
    throw new Error(
      `Relation where filter for ${relationName} must be an object`,
    );
  }

  const filter = value as Record<string, unknown>;
  const keys = RELATION_FILTER_KEYS.filter((key) => key in filter);

  if (keys.length !== 1) {
    throw new Error(
      `Relation where filter for ${relationName} must include exactly one of every, some, or none`,
    );
  }

  const key = keys[0];

  if (!key) {
    throw new Error(
      `Relation where filter for ${relationName} must include exactly one of every, some, or none`,
    );
  }

  const nestedWhere = filter[key];

  if (!isPlainObject(nestedWhere)) {
    throw new Error(`Relation where filter ${key} must be an object`);
  }

  return { key, where: nestedWhere as TableWhere<Table> };
};

const isRelationFilterValue = (value: unknown) => {
  if (!isPlainObject(value)) return false;

  const filter = value as Record<string, unknown>;

  for (const key of RELATION_FILTER_KEYS) {
    if (key in filter) return true;
  }

  return false;
};

const buildRelationForeignKeyCondition = (
  input: BuildRelationForeignKeyConditionInput,
) => {
  const { parentTable, parentAlias, relation, relationTable, relationAlias } =
    input;

  if (relation._type === "hasMany") {
    const { fk: foreignKey, source: sourceColumn } =
      resolveHasManyForeignKeyColumn(parentTable, relationTable);

    return `${relationAlias}.${quoteIdentifier(foreignKey.sqlName)} = ${parentAlias}.${quoteIdentifier(sourceColumn.sqlName)}`;
  }

  if (relation._type !== "hasOne") {
    throw new Error("Expected hasOne relation");
  }

  const { localForeignKey, target } = resolveHasOneForeignKeyColumn({
    sourceTable: parentTable,
    relationTable,
    relationForeignKey: relation._foreignKey,
  });

  return `${relationAlias}.${quoteIdentifier(target.sqlName)} = ${parentAlias}.${quoteIdentifier(localForeignKey.sqlName)}`;
};

const appendRelationWhereClause = <
  T extends Table,
  R extends TableRelations = Record<never, never>,
>(
  input: AppendRelationWhereClauseInput<T, R>,
) => {
  const {
    clauses,
    params,
    nextPlaceholder,
    parentAlias,
    table,
    relation,
    relationName,
    value,
  } = input;

  if (!parentAlias) {
    throw new Error("parentAlias is required for relation where filters");
  }

  const { key, where: nestedWhere } = getRelationFilter(relationName, value);
  const relationTable = relation._table;
  const relationAlias = `where_${relationName}__${relationTable.sqlName}`;
  const fkCondition = buildRelationForeignKeyCondition({
    parentTable: table,
    parentAlias,
    relation,
    relationTable,
    relationAlias,
  });
  const nested = buildWhereClause({
    nextPlaceholder,
    table: relationTable,
    where: nestedWhere,
  });
  const nestedCondition = nested.sql ? nested.sql : TRUE_WHERE_SQL;

  params.push(...nested.params);

  const relationFrom = `${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias}`;

  if (key === "some") {
    clauses.push(
      `EXISTS (SELECT 1 FROM ${relationFrom} WHERE ${fkCondition} AND (${nestedCondition}))`,
    );

    return;
  }

  if (key === "none") {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM ${relationFrom} WHERE ${fkCondition} AND (${nestedCondition}))`,
    );

    return;
  }

  clauses.push(
    `NOT EXISTS (SELECT 1 FROM ${relationFrom} WHERE ${fkCondition} AND NOT (${nestedCondition}))`,
  );
};

const appendWhereClause = <T extends Table, R extends TableRelations>(
  input: AppendWhereClauseInput<T, R>,
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

export const buildWhereClause = <
  T extends Table,
  R extends TableRelations = Record<never, never>,
>(
  input: BuildWhereClauseInput<T, R>,
): SqlFragment => {
  const { where, relations, parentAlias } = input;

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!where) return { sql: "", params };

  for (const [jsKey, value] of Object.entries(where)) {
    if (value === undefined) continue;

    const logicalWhereKey = getLogicalWhereKey(jsKey);

    if (logicalWhereKey) {
      appendLogicalWhereClause({
        ...input,
        clauses,
        params,
        jsKey: logicalWhereKey,
        value,
      });
      continue;
    }

    const relation = relations?.[jsKey];

    if (relation && isRelationFilterValue(value)) {
      appendRelationWhereClause({
        ...input,
        clauses,
        params,
        jsKey,
        value,
        relation,
        relationName: jsKey,
        parentAlias: parentAlias ?? quoteIdentifier(input.table.sqlName),
      });
      continue;
    }

    appendWhereClause({ ...input, clauses, params, jsKey, value });
  }

  const operator: LogicalJoinOperator = "AND";

  return { sql: clauses.join(` ${operator} `), params };
};

const getLogicalWhereKey = (jsKey: string): LogicalWhereKey | null => {
  if (jsKey === "$and") return jsKey;
  if (jsKey === "$not") return jsKey;
  if (jsKey === "$or") return jsKey;

  return null;
};

const getLogicalOperator = (
  jsKey: LogicalWhereJoinKey,
): LogicalJoinOperator => {
  if (jsKey === "$or") return "OR";

  return "AND";
};

const getLogicalWhereValues = (jsKey: LogicalWhereKey, value: unknown) => {
  if (jsKey === "$or" && !Array.isArray(value)) {
    throw new Error("$or where value must be an array");
  }

  if (Array.isArray(value)) return value;

  return [value];
};

const appendLogicalWhereClause = <
  T extends Table,
  R extends TableRelations = Record<never, never>,
>(
  input: AppendLogicalWhereClauseInput<T, R>,
) => {
  const { clauses, params, jsKey } = input;

  const collected = collectLogicalWhereClauses(input);

  if (typeof collected === "string") {
    clauses.push(collected);
    return;
  }

  if (!collected.nestedClauses.length) return;

  params.push(...collected.nestedParams);

  if (jsKey === "$not") {
    const operator: LogicalNotOperator = "NOT";
    const joinOperator: LogicalJoinOperator = "AND";
    const negatedClauses = collected.nestedClauses.map(
      (nestedClause) => `${operator} (${nestedClause})`,
    );
    const combinedNegatedClause = negatedClauses.join(` ${joinOperator} `);

    clauses.push(combinedNegatedClause);

    return;
  }

  const operator = getLogicalOperator(jsKey);

  clauses.push(`(${collected.nestedClauses.join(` ${operator} `)})`);
};

const collectLogicalWhereClauses = <
  T extends Table,
  R extends TableRelations = Record<never, never>,
>(
  input: CollectLogicalWhereClausesInput<T, R>,
): CollectedLogicalWhere => {
  const { jsKey, value } = input;

  const values = getLogicalWhereValues(jsKey, value);
  const nestedClauses: string[] = [];
  const nestedParams: unknown[] = [];

  for (const nestedValue of values) {
    if (!isPlainObject(nestedValue)) {
      throw new Error(`${jsKey} where value must contain object filters`);
    }

    const nested = buildWhereClause({
      ...input,
      where: nestedValue as TableWhere<T>,
    });

    if (!nested.sql) {
      if (jsKey === "$or") return TRUE_WHERE_SQL;

      continue;
    }

    nestedClauses.push(`(${nested.sql})`);
    nestedParams.push(...nested.params);
  }

  if (jsKey === "$or" && !nestedClauses.length) return FALSE_WHERE_SQL;

  return { nestedClauses, nestedParams };
};

const getColumnAlias = (sqlName: string, jsKey: string) => {
  return `${quoteIdentifier(sqlName)} AS ${quoteIdentifier(jsKey)}`;
};

export const buildSelectColumns = <T extends Table>(
  table: T,
  select?: TableSelect<T>,
) => {
  if (!select || Object.keys(select).length === 0) {
    const columnEntries = Object.entries(table.columns);
    const columnAliases = columnEntries.map(([key, column]) =>
      getColumnAlias(column.sqlName, key),
    );

    return columnAliases.join(", ");
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

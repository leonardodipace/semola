import type { SQL, TransactionSQL } from "bun";
import type { ColumnDef } from "../column.js";
import type { Table } from "../table.js";
import type {
  ColDefs,
  ColumnKind,
  ColumnMetaBase,
  DialectAdapter,
  OrderDirection,
  RelationDefs,
  SelectInput,
  SelectPlan,
  WhereInput,
  WhereNode,
  WherePredicate,
} from "../types.js";
import { isLikePredicateValue } from "./plan.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPrimaryKeyColumn(table: Table<ColDefs>) {
  for (const key in table.columns) {
    const col = table.columns[key];

    if (!col) {
      continue;
    }

    if (col.meta.isPrimaryKey) {
      return col;
    }
  }

  return null;
}

function findManyForeignKey(
  sourceTable: Table<ColDefs>,
  sourcePk: ColumnDef<ColumnKind, ColumnMetaBase, unknown>,
) {
  for (const key in sourceTable.columns) {
    const col = sourceTable.columns[key];

    if (!col) {
      continue;
    }

    if (!col.meta.references) continue;

    const referenced = col.meta.references();

    if (referenced === sourcePk) {
      return col;
    }
  }

  return null;
}

function buildLimitClause(
  sql: SQL | TransactionSQL,
  limit?: number,
  offset?: number,
) {
  let clause = sql``;

  if (limit != null) {
    clause = sql`${clause} LIMIT ${limit}`;
  }

  if (offset != null) {
    clause = sql`${clause} OFFSET ${offset}`;
  }

  return clause;
}

function buildOrderByClause<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  plan: SelectPlan<T>,
) {
  if (plan.orderBy.length === 0) {
    return sql``;
  }

  const fragments: SQL.Query<unknown>[] = [];

  for (const { key, direction } of plan.orderBy) {
    const col = table.columns[key];

    if (!col) {
      continue;
    }

    if (direction === "desc") {
      fragments.push(sql`${sql(col.meta.sqlName)} DESC`);
      continue;
    }

    fragments.push(sql`${sql(col.meta.sqlName)} ASC`);
  }

  if (fragments.length === 0) {
    return sql``;
  }

  let joined = fragments[0];

  for (let index = 1; index < fragments.length; index++) {
    const fragment = fragments[index];

    if (!fragment) {
      continue;
    }

    joined = sql`${joined}, ${fragment}`;
  }

  return sql`ORDER BY ${joined}`;
}

function buildOrderByFromInput<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  orderBy?: Partial<Record<keyof T, OrderDirection>>,
) {
  if (!orderBy) {
    return sql``;
  }

  const fragments: SQL.Query<unknown>[] = [];

  for (const jsKey in orderBy) {
    const direction = orderBy[jsKey as keyof T];

    const col = table.columns[jsKey as keyof T];

    if (!col) {
      continue;
    }

    if (direction === "desc") {
      fragments.push(sql`${sql(col.meta.sqlName)} DESC`);
      continue;
    }

    fragments.push(sql`${sql(col.meta.sqlName)} ASC`);
  }

  if (fragments.length === 0) {
    return sql``;
  }

  let joined = fragments[0];

  for (let index = 1; index < fragments.length; index++) {
    const fragment = fragments[index];

    if (!fragment) {
      continue;
    }

    joined = sql`${joined}, ${fragment}`;
  }

  return sql`ORDER BY ${joined}`;
}

function toColumnValue(
  table: Table<ColDefs>,
  key: string,
  value: unknown,
  dialectAdapter: DialectAdapter,
) {
  const col = table.columns[key];

  if (!col) {
    return {
      exists: false,
      kind: null,
      serialized: value,
      sqlName: key,
    };
  }

  return {
    exists: true,
    kind: col.kind,
    serialized: dialectAdapter.serializeValue(col.kind, value),
    sqlName: col.meta.sqlName,
  };
}

function serializeWherePredicate<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  predicate: WherePredicate<T>,
  dialectAdapter: DialectAdapter,
) {
  const { exists, kind, serialized, sqlName } = toColumnValue(
    table,
    predicate.key,
    predicate.value,
    dialectAdapter,
  );

  if (!exists) {
    return null;
  }

  const column = sql(sqlName);

  if (predicate.op === "eq") {
    return sql`${column} = ${serialized}`;
  }

  if (predicate.op === "neq") {
    return sql`${column} != ${serialized}`;
  }

  if (predicate.op === "gt") {
    return sql`${column} > ${serialized}`;
  }

  if (predicate.op === "gte") {
    return sql`${column} >= ${serialized}`;
  }

  if (predicate.op === "lt") {
    return sql`${column} < ${serialized}`;
  }

  if (predicate.op === "lte") {
    return sql`${column} <= ${serialized}`;
  }

  if (predicate.op === "like") {
    if (!isLikePredicateValue(predicate.value)) {
      return null;
    }

    const pattern = dialectAdapter.renderLikePattern(
      predicate.value.mode,
      predicate.value.value,
    );

    return sql`${column} LIKE ${pattern}`;
  }

  if (predicate.op === "in") {
    if (!Array.isArray(predicate.value)) {
      return null;
    }

    const values: unknown[] = new Array(predicate.value.length);

    for (let index = 0; index < predicate.value.length; index++) {
      const item = predicate.value[index];

      if (!kind) {
        values[index] = item;
        continue;
      }

      values[index] = dialectAdapter.serializeValue(kind, item);
    }

    return sql`${column} IN ${sql(values)}`;
  }

  if (predicate.op === "not_in") {
    if (!Array.isArray(predicate.value)) {
      return null;
    }

    const values: unknown[] = new Array(predicate.value.length);

    for (let index = 0; index < predicate.value.length; index++) {
      const item = predicate.value[index];

      if (!kind) {
        values[index] = item;
        continue;
      }

      values[index] = dialectAdapter.serializeValue(kind, item);
    }

    return sql`${column} NOT IN ${sql(values)}`;
  }

  if (predicate.op === "is_null") {
    return sql`${column} IS NULL`;
  }

  if (predicate.op === "is_not_null") {
    return sql`${column} IS NOT NULL`;
  }

  return null;
}

function serializeWhereNode<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  node: WhereNode<T>,
  dialectAdapter: DialectAdapter,
): SQL.Query<unknown> | null {
  if (node.kind === "predicate") {
    return serializeWherePredicate(sql, table, node, dialectAdapter);
  }

  const fragments: SQL.Query<unknown>[] = [];

  for (const child of node.nodes) {
    const fragment = serializeWhereNode(sql, table, child, dialectAdapter);

    if (!fragment) {
      continue;
    }

    fragments.push(fragment);
  }

  if (fragments.length === 0) {
    return null;
  }

  let joined = fragments[0];

  for (let index = 1; index < fragments.length; index++) {
    const fragment = fragments[index];

    if (!fragment) {
      continue;
    }

    if (node.kind === "or") {
      joined = sql`${joined} OR ${fragment}`;
      continue;
    }

    joined = sql`${joined} AND ${fragment}`;
  }

  return sql`(${joined})`;
}

function buildWhereClause<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  plan: SelectPlan<T>,
  dialectAdapter: DialectAdapter,
) {
  if (!plan.where) {
    return sql``;
  }

  const fragment = serializeWhereNode(sql, table, plan.where, dialectAdapter);

  if (!fragment) {
    return sql``;
  }

  return sql`WHERE ${fragment}`;
}

function buildWhereFromInput<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  where: WhereInput<T> | undefined,
  dialectAdapter: DialectAdapter,
) {
  if (!where) {
    return sql``;
  }

  const fragments: SQL.Query<unknown>[] = [];

  for (const jsKey in where) {
    const condition = where[jsKey as keyof T];

    const col = table.columns[jsKey as keyof T];

    if (!col) {
      continue;
    }

    const column = sql(col.meta.sqlName);

    if (!isRecord(condition)) {
      const serialized = dialectAdapter.serializeValue(col.kind, condition);
      fragments.push(sql`${column} = ${serialized}`);
      continue;
    }

    if ("startsWith" in condition) {
      const pattern = dialectAdapter.renderLikePattern(
        "startsWith",
        String(condition.startsWith),
      );
      fragments.push(sql`${column} LIKE ${pattern}`);
    }

    if ("endsWith" in condition) {
      const pattern = dialectAdapter.renderLikePattern(
        "endsWith",
        String(condition.endsWith),
      );
      fragments.push(sql`${column} LIKE ${pattern}`);
    }

    if ("contains" in condition) {
      const pattern = dialectAdapter.renderLikePattern(
        "contains",
        String(condition.contains),
      );
      fragments.push(sql`${column} LIKE ${pattern}`);
    }

    if ("gt" in condition) {
      const serialized = dialectAdapter.serializeValue(col.kind, condition.gt);
      fragments.push(sql`${column} > ${serialized}`);
    }

    if ("gte" in condition) {
      const serialized = dialectAdapter.serializeValue(col.kind, condition.gte);
      fragments.push(sql`${column} >= ${serialized}`);
    }

    if ("lt" in condition) {
      const serialized = dialectAdapter.serializeValue(col.kind, condition.lt);
      fragments.push(sql`${column} < ${serialized}`);
    }

    if ("lte" in condition) {
      const serialized = dialectAdapter.serializeValue(col.kind, condition.lte);
      fragments.push(sql`${column} <= ${serialized}`);
    }

    if ("in" in condition && Array.isArray(condition.in)) {
      const values: unknown[] = new Array(condition.in.length);

      for (let index = 0; index < condition.in.length; index++) {
        values[index] = dialectAdapter.serializeValue(
          col.kind,
          condition.in[index],
        );
      }

      fragments.push(sql`${column} IN ${sql(values)}`);
    }

    if ("notIn" in condition && Array.isArray(condition.notIn)) {
      const values: unknown[] = new Array(condition.notIn.length);

      for (let index = 0; index < condition.notIn.length; index++) {
        values[index] = dialectAdapter.serializeValue(
          col.kind,
          condition.notIn[index],
        );
      }

      fragments.push(sql`${column} NOT IN ${sql(values)}`);
    }

    if ("equals" in condition) {
      const serialized = dialectAdapter.serializeValue(
        col.kind,
        condition.equals,
      );
      fragments.push(sql`${column} = ${serialized}`);
    }

    if ("not" in condition) {
      const serialized = dialectAdapter.serializeValue(col.kind, condition.not);
      fragments.push(sql`${column} != ${serialized}`);
    }

    if ("isNull" in condition) {
      if (condition.isNull === true) {
        fragments.push(sql`${column} IS NULL`);
      }

      if (condition.isNull === false) {
        fragments.push(sql`${column} IS NOT NULL`);
      }
    }
  }

  if (fragments.length === 0) {
    return sql``;
  }

  let joined = fragments[0];

  for (let index = 1; index < fragments.length; index++) {
    const fragment = fragments[index];

    if (!fragment) {
      continue;
    }

    joined = sql`${joined} AND ${fragment}`;
  }

  return sql`WHERE ${joined}`;
}

export function serializeWherePlan<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  plan: SelectPlan<T>,
  dialectAdapter: DialectAdapter,
) {
  return buildWhereClause(sql, table, plan, dialectAdapter);
}

function buildJoinClauses<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: RelationDefs,
  plan: SelectPlan<T>,
) {
  if (plan.joins.length === 0) {
    return sql``;
  }

  let joinClause = sql``;
  const basePk = getPrimaryKeyColumn(table);

  if (!basePk) {
    return joinClause;
  }

  for (const join of plan.joins) {
    const rel = relations[join.relationKey];

    if (!rel) {
      continue;
    }

    const target = rel.table();
    const targetPk = getPrimaryKeyColumn(target);

    if (!targetPk) {
      continue;
    }

    if (rel.kind === "one") {
      joinClause = sql`${joinClause} LEFT JOIN ${sql(target.tableName)} ON ${sql(table.tableName)}.${sql(rel.foreignKey)} = ${sql(target.tableName)}.${sql(targetPk.meta.sqlName)}`;
      continue;
    }

    const foreignCol = findManyForeignKey(target, basePk);

    if (!foreignCol) {
      continue;
    }

    joinClause = sql`${joinClause} LEFT JOIN ${sql(target.tableName)} ON ${sql(target.tableName)}.${sql(foreignCol.meta.sqlName)} = ${sql(table.tableName)}.${sql(basePk.meta.sqlName)}`;
  }

  return joinClause;
}

function buildJoinFromInclude<T extends ColDefs, TRels>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: RelationDefs,
  include?: { [K in keyof TRels]?: true },
) {
  if (!include) {
    return sql``;
  }

  let joinClause = sql``;
  const basePk = getPrimaryKeyColumn(table);

  if (!basePk) {
    return joinClause;
  }

  for (const relationKey in include) {
    if (include[relationKey as keyof TRels] !== true) {
      continue;
    }

    const rel = relations[relationKey];

    if (!rel) {
      continue;
    }

    const target = rel.table();
    const targetPk = getPrimaryKeyColumn(target);

    if (!targetPk) {
      continue;
    }

    if (rel.kind === "one") {
      joinClause = sql`${joinClause} LEFT JOIN ${sql(target.tableName)} ON ${sql(table.tableName)}.${sql(rel.foreignKey)} = ${sql(target.tableName)}.${sql(targetPk.meta.sqlName)}`;
      continue;
    }

    const foreignCol = findManyForeignKey(target, basePk);

    if (!foreignCol) {
      continue;
    }

    joinClause = sql`${joinClause} LEFT JOIN ${sql(target.tableName)} ON ${sql(target.tableName)}.${sql(foreignCol.meta.sqlName)} = ${sql(table.tableName)}.${sql(basePk.meta.sqlName)}`;
  }

  return joinClause;
}

export function mapDataToSqlRow<T extends ColDefs>(
  table: Table<T>,
  data: Record<string, unknown>,
  dialectAdapter: DialectAdapter,
) {
  const row: Record<string, unknown> = {};

  for (const jsKey in data) {
    const value = data[jsKey];

    const col = table.columns[jsKey];

    if (!col) continue;

    row[col.meta.sqlName] = dialectAdapter.serializeValue(col.kind, value);
  }

  return row;
}

export function serializeSelectPlan<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: RelationDefs,
  plan: SelectPlan<T>,
  dialectAdapter: DialectAdapter,
) {
  const joins = buildJoinClauses(sql, table, relations, plan);
  const where = buildWhereClause(sql, table, plan, dialectAdapter);
  const orderBy = buildOrderByClause(sql, table, plan);
  const limitOffset = buildLimitClause(sql, plan.page.limit, plan.page.offset);

  return sql`SELECT * FROM ${sql(table.tableName)} ${joins} ${where} ${orderBy} ${limitOffset}`;
}

export function serializeWhereInput<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  where: WhereInput<T> | undefined,
  dialectAdapter: DialectAdapter,
) {
  return buildWhereFromInput(sql, table, where, dialectAdapter);
}

export function serializeSelectInput<T extends ColDefs, TRels>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: RelationDefs,
  input: SelectInput<T, TRels>,
  dialectAdapter: DialectAdapter,
) {
  const joins = buildJoinFromInclude(sql, table, relations, input.include);
  const where = buildWhereFromInput(sql, table, input.where, dialectAdapter);
  const orderBy = buildOrderByFromInput(sql, table, input.orderBy);
  const limitOffset = buildLimitClause(sql, input.limit, input.offset);

  return sql`SELECT * FROM ${sql(table.tableName)} ${joins} ${where} ${orderBy} ${limitOffset}`;
}

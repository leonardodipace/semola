import type { SQL, TransactionSQL } from "bun";
import type { ColumnDef } from "../column.js";
import type { Table } from "../table.js";
import type {
  ColDefs,
  ColumnKind,
  ColumnMetaBase,
  DialectAdapter,
  RelationDefs,
  SelectInput,
  SelectPlan,
  WhereInput,
  WhereNode,
  WherePredicate,
} from "../types.js";
import { buildSelectPlan, buildWhereNode } from "./plan.js";

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
  if (limit != null && offset != null) {
    return sql`LIMIT ${limit} OFFSET ${offset}`;
  }

  if (limit != null) {
    return sql`LIMIT ${limit}`;
  }

  if (offset != null) {
    return sql`OFFSET ${offset}`;
  }

  return sql``;
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

  const firstOrderBy = fragments[0];

  if (!firstOrderBy) {
    return sql``;
  }

  let joined = firstOrderBy;

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
    const likeValue = predicate.value;

    if (typeof likeValue !== "object" || likeValue === null) {
      return null;
    }

    const mode = Reflect.get(likeValue, "mode");
    const val = Reflect.get(likeValue, "value");

    if (mode !== "startsWith" && mode !== "endsWith" && mode !== "contains") {
      return null;
    }

    if (typeof val !== "string") {
      return null;
    }

    const pattern = dialectAdapter.renderLikePattern(mode, val);

    if (dialectAdapter.likeKeyword === "ILIKE") {
      return sql`${column} ILIKE ${pattern}`;
    }

    return sql`${column} LIKE ${pattern}`;
  }

  if (predicate.op === "in") {
    if (!Array.isArray(predicate.value)) {
      return null;
    }

    if (predicate.value.length === 0) {
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

    if (predicate.value.length === 0) {
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

  const firstNode = fragments[0];

  if (!firstNode) {
    return null;
  }

  let joined = firstNode;

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

function buildWhereFragment<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  node: WhereNode<T> | undefined,
  dialectAdapter: DialectAdapter,
) {
  if (!node) {
    return sql``;
  }

  const fragment = serializeWhereNode(sql, table, node, dialectAdapter);

  if (!fragment) {
    return sql``;
  }

  return sql`WHERE ${fragment}`;
}

function buildWhereClause<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  plan: SelectPlan<T>,
  dialectAdapter: DialectAdapter,
) {
  return buildWhereFragment(sql, table, plan.where, dialectAdapter);
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

    let foreignSqlName = rel.foreignKey;

    if (!foreignSqlName) {
      const foreignCol = findManyForeignKey(target, basePk);

      if (foreignCol) {
        foreignSqlName = foreignCol.meta.sqlName;
      }
    }

    if (!foreignSqlName) {
      continue;
    }

    joinClause = sql`${joinClause} LEFT JOIN ${sql(target.tableName)} ON ${sql(target.tableName)}.${sql(foreignSqlName)} = ${sql(table.tableName)}.${sql(basePk.meta.sqlName)}`;
  }

  return joinClause;
}

function buildBaseSelectColumns<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
) {
  const fragments: SQL.Query<unknown>[] = [];

  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    fragments.push(
      sql`${sql(table.tableName)}.${sql(col.meta.sqlName)} AS ${sql(jsKey)}`,
    );
  }

  const firstCol = fragments[0];

  if (!firstCol) {
    return sql`*`;
  }

  let joined = firstCol;

  for (let index = 1; index < fragments.length; index++) {
    const fragment = fragments[index];

    if (!fragment) {
      continue;
    }

    joined = sql`${joined}, ${fragment}`;
  }

  return joined;
}

function escapePostgresArrayString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function toPostgresArrayLiteral(value: unknown[]) {
  if (value.length === 0) {
    return "{}";
  }

  const items = value.map((item) => {
    if (item === null || item === undefined) {
      return "NULL";
    }

    if (typeof item === "number") {
      return String(item);
    }

    if (typeof item === "boolean") {
      return item ? "TRUE" : "FALSE";
    }

    if (item instanceof Date) {
      return `"${escapePostgresArrayString(item.toISOString())}"`;
    }

    return `"${escapePostgresArrayString(String(item))}"`;
  });

  return `{${items.join(",")}}`;
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

    if (
      dialectAdapter.dialect === "postgres" &&
      col.meta.isSqlArray &&
      Array.isArray(value)
    ) {
      row[col.meta.sqlName] = toPostgresArrayLiteral(value);
      continue;
    }

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
  const columns = buildBaseSelectColumns(sql, table);

  return sql`SELECT ${columns} FROM ${sql(table.tableName)} ${joins} ${where} ${orderBy} ${limitOffset}`;
}

export function serializeWhereInput<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  where: WhereInput<T> | undefined,
  dialectAdapter: DialectAdapter,
) {
  return buildWhereFragment(sql, table, buildWhereNode(where), dialectAdapter);
}

export function serializeSelectInput<T extends ColDefs, TRels>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: RelationDefs,
  input: SelectInput<T, TRels>,
  dialectAdapter: DialectAdapter,
) {
  return serializeSelectPlan(
    sql,
    table,
    relations,
    buildSelectPlan(input),
    dialectAdapter,
  );
}

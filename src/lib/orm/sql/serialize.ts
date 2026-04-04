import type { SQL, TransactionSQL } from "bun";
import { buildSelectColumns } from "../internal/table.js";
import type { Table } from "../table.js";
import type {
  ColDefs,
  DialectAdapter,
  RelationDefs,
  SelectInput,
  SelectPlan,
  WhereInput,
} from "../types.js";
import { buildSelectPlan, buildWhereNode } from "./plan.js";
import { buildLimitClause, buildOrderByClause } from "./serialize/clauses.js";
import { buildJoinClauses } from "./serialize/joins.js";
import { buildWhereFragment } from "./serialize/where.js";

export { mapDataToSqlRow } from "./serialize/values.js";

export function serializeWherePlan<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  plan: SelectPlan<T>,
  dialectAdapter: DialectAdapter,
) {
  return buildWhereFragment(sql, table, plan.where, dialectAdapter);
}

export function serializeSelectPlan<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: RelationDefs,
  plan: SelectPlan<T>,
  dialectAdapter: DialectAdapter,
) {
  const joins = buildJoinClauses(sql, table, relations, plan);
  const where = buildWhereFragment(sql, table, plan.where, dialectAdapter);
  const orderBy = buildOrderByClause(sql, table, plan);
  const limitOffset = buildLimitClause(sql, plan.page.limit, plan.page.offset);
  const columns = buildSelectColumns(sql, table);

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

import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../../table.js";
import type { ColDefs, Dialect, SelectPlan } from "../../types.js";

export function buildLimitClause(
  sql: SQL | TransactionSQL,
  limit?: number,
  offset?: number,
  dialect?: Dialect,
) {
  if (limit != null && offset != null) {
    return sql`LIMIT ${limit} OFFSET ${offset}`;
  }

  if (limit != null) {
    return sql`LIMIT ${limit}`;
  }

  if (offset != null) {
    if (dialect === "mysql") {
      return sql`LIMIT 18446744073709551615 OFFSET ${offset}`;
    }

    if (dialect === "sqlite") {
      return sql`LIMIT -1 OFFSET ${offset}`;
    }

    return sql`OFFSET ${offset}`;
  }

  return sql``;
}

export function buildOrderByClause<T extends ColDefs>(
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

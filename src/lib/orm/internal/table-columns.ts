import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../table.js";
import type { ColDefs } from "../types.js";

export function buildSelectColumns(
  sql: SQL | TransactionSQL,
  table: Table<ColDefs>,
) {
  return buildAliasedColumns(sql, table, true);
}

export function buildReturningColumns(
  sql: SQL | TransactionSQL,
  table: Table<ColDefs>,
) {
  return buildAliasedColumns(sql, table, false);
}

function buildAliasedColumns(
  sql: SQL | TransactionSQL,
  table: Table<ColDefs>,
  qualifyWithTableName: boolean,
) {
  const fragments: SQL.Query<unknown>[] = [];

  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    if (qualifyWithTableName) {
      fragments.push(
        sql`${sql(table.tableName)}.${sql(col.meta.sqlName)} AS ${sql(jsKey)}`,
      );
      continue;
    }

    fragments.push(sql`${sql(col.meta.sqlName)} AS ${sql(jsKey)}`);
  }

  const first = fragments[0];

  if (!first) {
    return sql`*`;
  }

  let joined = first;

  for (let index = 1; index < fragments.length; index++) {
    const fragment = fragments[index];

    if (!fragment) {
      continue;
    }

    joined = sql`${joined}, ${fragment}`;
  }

  return joined;
}

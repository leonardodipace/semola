import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../../table.js";
import type { ColDefs, DialectAdapter, WhereNode } from "../../types.js";
import { serializeWhereNode } from "./where/tree.js";

export function buildWhereFragment<T extends ColDefs>(
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

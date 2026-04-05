import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../../../table.js";
import type { ColDefs, DialectAdapter, WhereNode } from "../../../types.js";
import { serializeWherePredicate } from "./predicate.js";

export function serializeWhereNode<T extends ColDefs>(
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

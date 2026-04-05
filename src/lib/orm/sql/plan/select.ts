import type {
  ColDefs,
  JoinNode,
  OrderDirection,
  SelectInput,
  SelectPlan,
} from "../../types.js";
import { buildWhereNode } from "./where.js";

function buildJoinNodes<TRels>(include?: { [K in keyof TRels]?: true }) {
  if (!include) {
    return [];
  }

  const joins: JoinNode[] = [];

  for (const [relationKey, enabled] of Object.entries(include)) {
    if (enabled !== true) {
      continue;
    }

    joins.push({
      relationKey,
      kind: "left",
    });
  }

  return joins;
}

function buildOrderByNodes<T extends ColDefs>(
  orderBy?: Partial<Record<keyof T, OrderDirection>>,
) {
  if (!orderBy) {
    return [];
  }

  const nodes: Array<{ key: keyof T & string; direction: OrderDirection }> = [];

  for (const [key, direction] of Object.entries(orderBy)) {
    nodes.push({
      key: key as keyof T & string,
      direction: direction === "desc" ? "desc" : "asc",
    });
  }

  return nodes;
}

export function buildSelectPlan<T extends ColDefs, TRels>(
  input: SelectInput<T, TRels> = {},
): SelectPlan<T> {
  return {
    where: buildWhereNode(input.where),
    joins: buildJoinNodes(input.include),
    orderBy: buildOrderByNodes(input.orderBy),
    page: {
      limit: input.limit,
      offset: input.offset,
    },
  };
}

import type {
  ClauseOperator,
  ColDefs,
  JoinNode,
  OrderDirection,
  SelectInput,
  SelectPlan,
  WhereInput,
  WhereNode,
} from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOperatorPredicates<T extends ColDefs>(
  key: keyof T & string,
  condition: Record<string, unknown>,
) {
  const predicates: Array<WhereNode<T>> = [];

  if ("startsWith" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "like",
      value: {
        mode: "startsWith",
        value: String(condition.startsWith),
      },
    });
  }

  if ("endsWith" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "like",
      value: {
        mode: "endsWith",
        value: String(condition.endsWith),
      },
    });
  }

  if ("contains" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "like",
      value: {
        mode: "contains",
        value: String(condition.contains),
      },
    });
  }

  if ("gt" in condition) {
    predicates.push({ kind: "predicate", key, op: "gt", value: condition.gt });
  }

  if ("gte" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "gte",
      value: condition.gte,
    });
  }

  if ("lt" in condition) {
    predicates.push({ kind: "predicate", key, op: "lt", value: condition.lt });
  }

  if ("lte" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "lte",
      value: condition.lte,
    });
  }

  if ("in" in condition) {
    predicates.push({ kind: "predicate", key, op: "in", value: condition.in });
  }

  if ("notIn" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "not_in",
      value: condition.notIn,
    });
  }

  if ("equals" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "eq",
      value: condition.equals,
    });
  }

  if ("not" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "neq",
      value: condition.not,
    });
  }

  if ("isNull" in condition) {
    if (condition.isNull === true) {
      predicates.push({ kind: "predicate", key, op: "is_null" });
    }

    if (condition.isNull === false) {
      predicates.push({ kind: "predicate", key, op: "is_not_null" });
    }
  }

  return predicates;
}

function buildWhereNode<T extends ColDefs>(where?: WhereInput<T>) {
  if (!where) {
    return undefined;
  }

  const nodes: Array<WhereNode<T>> = [];

  for (const [key, condition] of Object.entries(where)) {
    const typedKey = key as keyof T & string;

    if (!isRecord(condition)) {
      nodes.push({
        kind: "predicate",
        key: typedKey,
        op: "eq",
        value: condition,
      });

      continue;
    }

    const predicates = toOperatorPredicates(
      typedKey,
      condition as Record<string, unknown>,
    );

    for (const predicate of predicates) {
      nodes.push(predicate);
    }
  }

  if (nodes.length === 0) {
    return undefined;
  }

  if (nodes.length === 1) {
    return nodes[0];
  }

  return {
    kind: "and" as const,
    nodes,
  };
}

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

export type LikeMode = "startsWith" | "endsWith" | "contains";

export type LikePredicateValue = {
  mode: LikeMode;
  value: string;
};

export function isLikePredicateValue(
  value: unknown,
): value is LikePredicateValue {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.mode !== "string") {
    return false;
  }

  if (
    value.mode !== "startsWith" &&
    value.mode !== "endsWith" &&
    value.mode !== "contains"
  ) {
    return false;
  }

  return typeof value.value === "string";
}

export function isValueOperator(op: ClauseOperator) {
  return (
    op === "eq" ||
    op === "neq" ||
    op === "gt" ||
    op === "gte" ||
    op === "lt" ||
    op === "lte" ||
    op === "like" ||
    op === "in" ||
    op === "not_in"
  );
}

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

function toOperatorPredicates<T extends ColDefs>(
  key: keyof T & string,
  condition: object,
) {
  const predicates: Array<WhereNode<T>> = [];

  if ("startsWith" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "like",
      value: {
        mode: "startsWith",
        value: String(Reflect.get(condition, "startsWith")),
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
        value: String(Reflect.get(condition, "endsWith")),
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
        value: String(Reflect.get(condition, "contains")),
      },
    });
  }

  if ("gt" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "gt",
      value: Reflect.get(condition, "gt"),
    });
  }

  if ("gte" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "gte",
      value: Reflect.get(condition, "gte"),
    });
  }

  if ("lt" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "lt",
      value: Reflect.get(condition, "lt"),
    });
  }

  if ("lte" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "lte",
      value: Reflect.get(condition, "lte"),
    });
  }

  if ("in" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "in",
      value: Reflect.get(condition, "in"),
    });
  }

  if ("notIn" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "not_in",
      value: Reflect.get(condition, "notIn"),
    });
  }

  if ("equals" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "eq",
      value: Reflect.get(condition, "equals"),
    });
  }

  if ("not" in condition) {
    predicates.push({
      kind: "predicate",
      key,
      op: "neq",
      value: Reflect.get(condition, "not"),
    });
  }

  if ("isNull" in condition) {
    const isNull = Reflect.get(condition, "isNull");

    if (isNull === true) {
      predicates.push({ kind: "predicate", key, op: "is_null" });
    }

    if (isNull === false) {
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

    if (typeof condition !== "object" || condition === null) {
      nodes.push({
        kind: "predicate",
        key: typedKey,
        op: "eq",
        value: condition,
      });

      continue;
    }

    const predicates = toOperatorPredicates(typedKey, condition);

    if (predicates.length === 0) {
      nodes.push({
        kind: "predicate",
        key: typedKey,
        op: "eq",
        value: condition,
      });
      continue;
    }

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

export function isLikePredicateValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const mode = Reflect.get(value, "mode");

  if (mode !== "startsWith" && mode !== "endsWith" && mode !== "contains") {
    return false;
  }

  return typeof Reflect.get(value, "value") === "string";
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

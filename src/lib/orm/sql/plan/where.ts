import type { ColDefs, WhereInput, WhereNode } from "../../types.js";
import {
  isLikePredicateValue,
  isValueOperator,
  type LikeMode,
  type LikePredicateValue,
} from "./where/guards.js";
import { toOperatorPredicates } from "./where/operators.js";

export function buildWhereNode<T extends ColDefs>(where?: WhereInput<T>) {
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

export { isLikePredicateValue, isValueOperator };
export type { LikeMode, LikePredicateValue };

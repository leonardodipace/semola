import type { ColDefs, WhereInput, WhereNode } from "../../types.js";
import {
  isLikePredicateValue,
  isValueOperator,
  type LikeMode,
  type LikePredicateValue,
} from "./where/guards.js";
import { toOperatorPredicates } from "./where/operators.js";

function combineWhereNodes<T extends ColDefs>(
  kind: "and" | "or",
  nodes: Array<WhereNode<T>>,
) {
  if (nodes.length === 0) {
    return undefined;
  }

  if (nodes.length === 1) {
    return nodes[0];
  }

  return { kind, nodes };
}

export function buildWhereNode<T extends ColDefs>(where?: WhereInput<T>) {
  if (!where) {
    return undefined;
  }

  const nodes: Array<WhereNode<T>> = [];

  const andInputs = where.and;

  if (andInputs) {
    for (const entry of andInputs) {
      const node = buildWhereNode(entry);

      if (!node) {
        continue;
      }

      nodes.push(node);
    }
  }

  const orInputs = where.or;

  if (orInputs) {
    const orNodes: Array<WhereNode<T>> = [];

    for (const entry of orInputs) {
      const node = buildWhereNode(entry);

      if (!node) {
        continue;
      }

      orNodes.push(node);
    }

    const orNode = combineWhereNodes("or", orNodes);

    if (orNode) {
      nodes.push(orNode);
    }
  }

  for (const [key, condition] of Object.entries(where)) {
    if (key === "and") {
      continue;
    }

    if (key === "or") {
      continue;
    }

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

  return combineWhereNodes("and", nodes);
}

export { isLikePredicateValue, isValueOperator };
export type { LikeMode, LikePredicateValue };

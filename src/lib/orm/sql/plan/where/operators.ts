import type { ColDefs, WhereNode } from "../../../types.js";

export function toOperatorPredicates<T extends ColDefs>(
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

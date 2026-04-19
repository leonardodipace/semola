import type { ClauseOperator } from "../../../types.js";

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

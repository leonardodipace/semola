import type { SchemaSnapshot } from "../types.js";

const UNDEFINED_SENTINEL = Object.freeze({});

function safeStringify(value: unknown) {
  const seen = new Set<object>();

  return JSON.stringify(value, (_key, current) => {
    if (typeof current !== "object" || current === null) {
      return current;
    }

    if (seen.has(current)) {
      return "[Circular]";
    }

    seen.add(current);
    return current;
  });
}

function stableValue(value: unknown) {
  if (value === undefined) {
    return UNDEFINED_SENTINEL;
  }

  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  const serialized = safeStringify(value);

  if (serialized !== undefined) {
    return serialized;
  }

  return String(value);
}

export function defaultsEqual(
  left: SchemaSnapshot["tables"][string]["columns"][string],
  right: SchemaSnapshot["tables"][string]["columns"][string],
) {
  const leftKind = left.defaultKind ?? null;
  const rightKind = right.defaultKind ?? null;

  if (leftKind !== rightKind) {
    return false;
  }

  if (leftKind !== "value") {
    return true;
  }

  return stableValue(left.defaultValue) === stableValue(right.defaultValue);
}

export function columnsEqual(
  left: SchemaSnapshot["tables"][string]["columns"][string],
  right: SchemaSnapshot["tables"][string]["columns"][string],
) {
  if (left.sqlName !== right.sqlName) return false;
  if (left.kind !== right.kind) return false;
  if ((left.isSqlArray ?? false) !== (right.isSqlArray ?? false)) return false;
  if (left.isPrimaryKey !== right.isPrimaryKey) return false;
  if (left.isNotNull !== right.isNotNull) return false;
  if (left.isUnique !== right.isUnique) return false;
  if (left.hasDefault !== right.hasDefault) return false;
  if (!defaultsEqual(left, right)) return false;
  if (left.referencesTable !== right.referencesTable) return false;
  if (left.referencesColumn !== right.referencesColumn) return false;
  if (left.onDeleteAction !== right.onDeleteAction) return false;
  return true;
}

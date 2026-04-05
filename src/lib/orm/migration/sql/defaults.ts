import type { ColumnSnapshot, SchemaSnapshot } from "../types.js";
import { quoteLiteral } from "./identifiers.js";

export function uuidDefaultExpression(dialect: SchemaSnapshot["dialect"]) {
  if (dialect === "postgres") {
    return "gen_random_uuid()";
  }

  if (dialect === "mysql") {
    return "UUID()";
  }

  return "(lower(hex(randomblob(16))))";
}

export function serializeDefaultValue(
  dialect: SchemaSnapshot["dialect"],
  column: ColumnSnapshot,
) {
  if (column.defaultKind !== "value") {
    return null;
  }

  const value = column.defaultValue;

  if (value === null) {
    return "NULL";
  }

  if (column.kind === "json") {
    return quoteLiteral(JSON.stringify(value));
  }

  if (column.kind === "jsonb") {
    return quoteLiteral(JSON.stringify(value));
  }

  if (column.kind === "boolean") {
    if (typeof value !== "boolean") {
      return null;
    }

    if (dialect === "sqlite") {
      return value ? "1" : "0";
    }

    return value ? "TRUE" : "FALSE";
  }

  if (column.kind === "number") {
    if (typeof value !== "number") {
      return null;
    }

    if (Number.isNaN(value)) {
      return null;
    }

    return String(value);
  }

  if (value instanceof Date) {
    return quoteLiteral(value.toISOString());
  }

  if (typeof value === "string") {
    return quoteLiteral(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  return quoteLiteral(JSON.stringify(value));
}

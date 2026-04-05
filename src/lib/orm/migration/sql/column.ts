import type { ColumnSnapshot, SchemaSnapshot } from "../types.js";
import { serializeDefaultValue, uuidDefaultExpression } from "./defaults.js";
import { quoteIdentifier } from "./identifiers.js";

export function columnType(
  dialect: SchemaSnapshot["dialect"],
  kind: ColumnSnapshot["kind"],
) {
  switch (kind) {
    case "uuid":
      if (dialect === "postgres") {
        return "UUID";
      }

      if (dialect === "mysql") {
        return "CHAR(36)";
      }

      return "TEXT";

    case "string":
      if (dialect === "mysql") {
        return "VARCHAR(255)";
      }

      return "TEXT";

    case "number":
      if (dialect === "postgres") {
        return "DOUBLE PRECISION";
      }

      return "REAL";

    case "boolean":
      if (dialect === "postgres") {
        return "BOOLEAN";
      }

      return "INTEGER";

    case "json":
      if (dialect === "postgres") {
        return "JSON";
      }

      if (dialect === "sqlite") {
        return "TEXT";
      }

      return "JSON";

    case "jsonb":
      if (dialect === "postgres") {
        return "JSONB";
      }

      if (dialect === "sqlite") {
        return "TEXT";
      }

      return "JSON";

    case "date":
      if (dialect === "mysql") {
        return "DATETIME";
      }

      if (dialect === "sqlite") {
        return "TEXT";
      }

      return "TIMESTAMP";

    default:
      throw new Error(`Unknown column kind: ${kind}`);
  }
}

export function buildColumnDefinition(
  dialect: SchemaSnapshot["dialect"],
  column: ColumnSnapshot,
  options?: {
    includeReferences?: boolean;
  },
) {
  const includeReferences = options?.includeReferences ?? true;

  const parts = [
    quoteIdentifier(dialect, column.sqlName),
    columnType(dialect, column.kind),
  ];

  if (column.isPrimaryKey) {
    parts.push("PRIMARY KEY");
  }

  if (column.isNotNull) {
    parts.push("NOT NULL");
  }

  if (column.isUnique) {
    parts.push("UNIQUE");
  }

  const serializedDefault = serializeDefaultValue(dialect, column);

  if (serializedDefault) {
    parts.push("DEFAULT", serializedDefault);
  }

  if (column.kind === "uuid" && column.isPrimaryKey && !column.hasDefault) {
    parts.push("DEFAULT", uuidDefaultExpression(dialect));
  }

  if (includeReferences && column.referencesTable && column.referencesColumn) {
    parts.push(
      "REFERENCES",
      quoteIdentifier(dialect, column.referencesTable),
      `(${quoteIdentifier(dialect, column.referencesColumn)})`,
    );

    if (column.onDeleteAction) {
      parts.push("ON DELETE", column.onDeleteAction);
    }
  }

  return parts.join(" ");
}

export function buildForeignKeyConstraint(
  dialect: SchemaSnapshot["dialect"],
  column: ColumnSnapshot,
) {
  if (!column.referencesTable) {
    return null;
  }

  if (!column.referencesColumn) {
    return null;
  }

  const parts = [
    "FOREIGN KEY",
    `(${quoteIdentifier(dialect, column.sqlName)})`,
    "REFERENCES",
    quoteIdentifier(dialect, column.referencesTable),
    `(${quoteIdentifier(dialect, column.referencesColumn)})`,
  ];

  if (column.onDeleteAction) {
    parts.push("ON DELETE", column.onDeleteAction);
  }

  return parts.join(" ");
}

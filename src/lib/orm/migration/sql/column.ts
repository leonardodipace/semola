import type { ColumnSnapshot, SchemaSnapshot } from "../types.js";
import { serializeDefaultValue, uuidDefaultExpression } from "./defaults.js";
import { quoteIdentifier } from "./identifiers.js";

const COLUMN_TYPES = {
  uuid: { postgres: "UUID", mysql: "CHAR(36)", sqlite: "TEXT" },
  string: { postgres: "TEXT", mysql: "VARCHAR(255)", sqlite: "TEXT" },
  number: { postgres: "DOUBLE PRECISION", mysql: "REAL", sqlite: "REAL" },
  boolean: { postgres: "BOOLEAN", mysql: "INTEGER", sqlite: "INTEGER" },
  json: { postgres: "JSON", mysql: "JSON", sqlite: "TEXT" },
  jsonb: { postgres: "JSONB", mysql: "JSON", sqlite: "TEXT" },
  date: { postgres: "TIMESTAMP", mysql: "DATETIME", sqlite: "TEXT" },
} satisfies Record<string, Record<SchemaSnapshot["dialect"], string>>;

export function columnType(
  dialect: SchemaSnapshot["dialect"],
  column: ColumnSnapshot,
) {
  if (column.kind === "enum") {
    return column.enumName;
  }

  const types = COLUMN_TYPES[column.kind];

  if (!types) {
    throw new Error(`Unknown column kind: ${column.kind}`);
  }

  return types[dialect];
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
    columnType(dialect, column),
  ];

  if (column.isSqlArray) {
    if (dialect !== "postgres") {
      throw new Error(`Array type is not supported for dialect: '${dialect}'`);
    }

    parts.push("ARRAY");
  }

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

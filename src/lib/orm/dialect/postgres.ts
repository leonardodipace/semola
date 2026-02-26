import type { ColumnKind } from "../column/types.js";
import type { Table } from "../table/index.js";
import { buildCreateTableSql, escapeStringSingleQuote } from "./shared.js";
import type { ColumnTypeMapping, Dialect } from "./types.js";

// PostgreSQL dialect implementation.
// Fully implements all query building and type conversion for PostgreSQL databases.
// Uses $1, $2, $3 placeholder syntax and BIGSERIAL for auto-incrementing primary keys.
export class PostgresDialect implements Dialect {
  public readonly name = "postgres";

  public readonly types: ColumnTypeMapping = {
    number: "INTEGER",
    string: "TEXT",
    boolean: "BOOLEAN",
    date: "TIMESTAMP",
    json: "JSON",
    jsonb: "JSONB",
    uuid: "UUID",
  };

  private quoteIdentifier(identifier: string) {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private formatDefaultValue(kind: ColumnKind, value: unknown) {
    if (kind === "number" && typeof value === "number") {
      return String(value);
    }

    if (kind === "boolean" && typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (kind === "date") {
      if (value instanceof Date) {
        return `'${escapeStringSingleQuote(value.toISOString())}'`;
      }
      return `'${escapeStringSingleQuote(String(value))}'`;
    }

    if (kind === "json" || kind === "jsonb") {
      const jsonValue =
        typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
      return `'${escapeStringSingleQuote(jsonValue)}'`;
    }

    return `'${escapeStringSingleQuote(String(value))}'`;
  }

  public buildCreateTable(table: Table) {
    return buildCreateTableSql(
      table,
      this.types,
      (s) => this.quoteIdentifier(s),
      (kind, value) => this.formatDefaultValue(kind, value),
      "BIGSERIAL",
    );
  }

  public convertBooleanValue(value: unknown) {
    // Postgres returns native booleans
    if (typeof value === "boolean") {
      return value;
    }
    // Fallback for edge cases
    return Boolean(value);
  }
}

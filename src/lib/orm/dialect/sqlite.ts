import type { ColumnKind } from "../column/types.js";
import type { Table } from "../table/index.js";
import { buildCreateTableSql, escapeStringSingleQuote } from "./shared.js";
import type { ColumnTypeMapping, Dialect } from "./types.js";

// SQLite dialect implementation.
// Fully implements all query building and type conversion for SQLite databases.
export class SqliteDialect implements Dialect {
  public readonly name = "sqlite";
  public readonly uuidFunction = null;

  public readonly types: ColumnTypeMapping = {
    number: "INTEGER",
    string: "TEXT",
    boolean: "INTEGER", // SQLite stores booleans as 0/1
    date: "INTEGER", // SQLite stores dates as milliseconds since epoch
    json: "TEXT", // SQLite stores JSON as text
    jsonb: "TEXT", // SQLite stores JSONB as text (no distinction)
    uuid: "TEXT", // SQLite stores UUIDs as text
  };

  private quoteIdentifier(identifier: string) {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private formatDefaultValue(kind: ColumnKind, value: unknown) {
    if (kind === "number" && typeof value === "number") {
      return String(value);
    }

    if (kind === "boolean" && typeof value === "boolean") {
      return value ? "1" : "0";
    }

    if (kind === "date") {
      if (value instanceof Date) {
        return String(value.getTime());
      }
      return String(value);
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
      null,
      this.uuidFunction,
    );
  }

  public convertBooleanValue(value: unknown) {
    // SQLite stores booleans as 0/1
    if (typeof value === "number") {
      return value === 1;
    }
    // Already a boolean
    if (typeof value === "boolean") {
      return value;
    }
    return false;
  }
}

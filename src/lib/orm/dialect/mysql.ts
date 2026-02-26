import type { ColumnKind } from "../column/types.js";
import type { Table } from "../table/index.js";
import { buildCreateTableSql } from "./shared.js";
import type { ColumnTypeMapping, Dialect } from "./types.js";

// MySQL dialect implementation.
// Fully implements all query building and type conversion for MySQL databases.
// Uses ? placeholder syntax and BIGINT AUTO_INCREMENT for auto-incrementing primary keys.
export class MysqlDialect implements Dialect {
  public readonly name = "mysql";
  public readonly uuidFunction = "(UUID())";

  public readonly types: ColumnTypeMapping = {
    number: "INT",
    string: "VARCHAR(255)",
    boolean: "BOOLEAN",
    date: "DATETIME",
    json: "JSON",
    jsonb: "JSON", // MySQL doesn't distinguish JSONB, uses JSON
    uuid: "CHAR(36)", // MySQL stores UUIDs as CHAR(36)
  };

  private escapeString(value: string) {
    // Escape backslashes first, then single quotes
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  private quoteIdentifier(identifier: string) {
    return `\`${identifier.replace(/`/g, "``")}\``;
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
        // Format as MySQL DATETIME: YYYY-MM-DD HH:MM:SS
        const formatted = value.toISOString().slice(0, 19).replace("T", " ");
        return `'${this.escapeString(formatted)}'`;
      }
      return `'${this.escapeString(String(value))}'`;
    }

    if (kind === "json" || kind === "jsonb") {
      const jsonValue =
        typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
      return `'${this.escapeString(jsonValue)}'`;
    }

    return `'${this.escapeString(String(value))}'`;
  }

  public buildCreateTable(table: Table) {
    return buildCreateTableSql(
      table,
      this.types,
      (s) => this.quoteIdentifier(s),
      (kind, value) => this.formatDefaultValue(kind, value),
      "BIGINT AUTO_INCREMENT",
      this.uuidFunction,
    );
  }

  public convertBooleanValue(value: unknown) {
    // MySQL can return booleans as 1/0 or as native booleans
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    // Fallback for edge cases
    return Boolean(value);
  }
}

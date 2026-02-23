import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";
import { buildColumnDef } from "./shared.js";
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

  private escapeString(value: string) {
    return value.replace(/'/g, "''");
  }

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
        return `'${this.escapeString(value.toISOString())}'`;
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

  public buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(table: Table<Columns>) {
    const columnDefs: string[] = [];

    for (const [_key, column] of Object.entries(table.columns)) {
      const [error, def] = buildColumnDef(
        column,
        this.types,
        (s) => this.quoteIdentifier(s),
        (kind, value) => this.formatDefaultValue(kind, value),
        "BIGSERIAL",
      );
      if (error) return err(error.type, error.message);
      columnDefs.push(def);
    }

    return ok(
      `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(table.sqlName)} (${columnDefs.join(", ")})`,
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

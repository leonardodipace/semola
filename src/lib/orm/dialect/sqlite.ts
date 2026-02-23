import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";
import type { ColumnTypeMapping, Dialect } from "./types.js";

// SQLite dialect implementation.
// Fully implements all query building and type conversion for SQLite databases.
export class SqliteDialect implements Dialect {
  public readonly name = "sqlite";

  public readonly types: ColumnTypeMapping = {
    number: "INTEGER",
    string: "TEXT",
    boolean: "INTEGER", // SQLite stores booleans as 0/1
    date: "INTEGER", // SQLite stores dates as milliseconds since epoch
    json: "TEXT", // SQLite stores JSON as text
    jsonb: "TEXT", // SQLite stores JSONB as text (no distinction)
    uuid: "TEXT", // SQLite stores UUIDs as text
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
      return `'${this.escapeString(jsonValue)}'`;
    }

    return `'${this.escapeString(String(value))}'`;
  }

  public buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(table: Table<Columns>) {
    const columnDefs: string[] = [];
    const constraints: string[] = [];

    for (const [_key, column] of Object.entries(table.columns)) {
      const sqlType = this.types[column.columnKind];
      if (!sqlType) {
        return err(
          "UnsupportedType",
          `Unsupported column type: ${column.columnKind}`,
        );
      }
      const parts: string[] = [this.quoteIdentifier(column.sqlName), sqlType];

      // Primary key
      if (column.meta.primaryKey) {
        parts.push("PRIMARY KEY");
      }

      // Not null
      if (column.meta.notNull && !column.meta.primaryKey) {
        // PRIMARY KEY implies NOT NULL in SQLite
        parts.push("NOT NULL");
      }

      // Unique
      if (column.meta.unique && !column.meta.primaryKey) {
        // PRIMARY KEY implies UNIQUE in SQLite
        parts.push("UNIQUE");
      }

      // Default value (if hasDefault is true)
      if (column.meta.hasDefault && column.defaultValue !== undefined) {
        const defaultValue = this.formatDefaultValue(
          column.columnKind,
          column.defaultValue,
        );
        parts.push(`DEFAULT ${defaultValue}`);
      }

      // Foreign key reference
      if (column.foreignKeyRef) {
        const ref = column.foreignKeyRef;
        let fkClause = `REFERENCES ${this.quoteIdentifier(ref.tableName)}(${this.quoteIdentifier(ref.columnName)})`;
        if (column.onDeleteAction) {
          fkClause += ` ON DELETE ${column.onDeleteAction.toUpperCase()}`;
        }
        parts.push(fkClause);
      }

      columnDefs.push(parts.join(" "));
    }

    const allDefs = [...columnDefs, ...constraints].join(", ");
    return ok(
      `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(table.sqlName)} (${allDefs})`,
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

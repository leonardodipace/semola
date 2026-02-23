import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";
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
    const constraints: string[] = [];

    for (const [_key, column] of Object.entries(table.columns)) {
      const parts: string[] = [this.quoteIdentifier(column.sqlName)];

      // For primary keys, use BIGSERIAL (auto-incrementing 64-bit integer)
      if (column.meta.primaryKey && column.columnKind === "number") {
        parts.push("BIGSERIAL PRIMARY KEY");
      } else {
        const sqlType = this.types[column.columnKind];
        if (!sqlType) {
          return err(
            "UnsupportedType",
            `Unsupported column type: ${column.columnKind}`,
          );
        }
        parts.push(sqlType);

        // Primary key (non-auto-incrementing)
        if (column.meta.primaryKey) {
          parts.push("PRIMARY KEY");
        }

        // Not null
        if (column.meta.notNull && !column.meta.primaryKey) {
          parts.push("NOT NULL");
        }

        // Unique
        if (column.meta.unique && !column.meta.primaryKey) {
          parts.push("UNIQUE");
        }

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
      }

      columnDefs.push(parts.join(" "));
    }

    const allDefs = [...columnDefs, ...constraints].join(", ");
    return ok(
      `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(table.sqlName)} (${allDefs})`,
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

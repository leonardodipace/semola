import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";
import type {
  ColumnTypeMapping,
  DeleteOptions,
  Dialect,
  InsertOptions,
  SelectOptions,
  UpdateOptions,
} from "./types.js";

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

  // Convert ? placeholders to $1, $2, $3 format for Postgres
  private toPostgresPlaceholders(sql: string, paramCount: number) {
    let result = sql;
    for (let i = 1; i <= paramCount; i++) {
      // Replace left-to-right so placeholders map in order
      result = result.replace("?", `$${i}`);
    }
    return result;
  }

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

  public buildSelect(
    tableName: string,
    columns: string[],
    options: SelectOptions,
  ) {
    const parts: string[] = [];
    const params: unknown[] = [];

    // SELECT clause
    const columnList = columns
      .map((column) => this.quoteIdentifier(column))
      .join(", ");
    parts.push(`SELECT ${columnList} FROM ${this.quoteIdentifier(tableName)}`);

    // WHERE clause
    if (options.where) {
      parts.push(`WHERE ${options.where.text}`);
      params.push(...options.where.values);
    }

    // LIMIT/OFFSET
    const pagination = this.buildPagination(options.limit, options.offset);
    if (pagination) {
      parts.push(pagination);
    }

    const sql = this.toPostgresPlaceholders(parts.join(" "), params.length);
    return { sql, params };
  }

  public buildInsert(options: InsertOptions) {
    const columns = Object.keys(options.values);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const columnList = columns
      .map((column) => this.quoteIdentifier(column))
      .join(", ");

    const sql = `INSERT INTO ${this.quoteIdentifier(options.tableName)} (${columnList}) VALUES (${placeholders}) RETURNING *`;
    const params = Object.values(options.values);

    return { sql, params };
  }

  public buildUpdate(options: UpdateOptions) {
    const columns = Object.keys(options.values);
    const setClause = columns
      .map((col, i) => `${this.quoteIdentifier(col)} = $${i + 1}`)
      .join(", ");

    const whereClause = this.toPostgresPlaceholders(
      options.where.text,
      options.where.values.length,
    );

    // Adjust where clause placeholders to account for SET clause params
    const adjustedWhereClause = whereClause.replace(
      /\$(\d+)/g,
      (_, num) => `$${Number.parseInt(num, 10) + columns.length}`,
    );

    const sql = `UPDATE ${this.quoteIdentifier(options.tableName)} SET ${setClause} WHERE ${adjustedWhereClause} RETURNING *`;
    const params = [...Object.values(options.values), ...options.where.values];

    return { sql, params };
  }

  public buildDelete(options: DeleteOptions) {
    const whereClause = this.toPostgresPlaceholders(
      options.where.text,
      options.where.values.length,
    );

    const sql = `DELETE FROM ${this.quoteIdentifier(options.tableName)} WHERE ${whereClause} RETURNING *`;
    const params = [...options.where.values];

    return { sql, params };
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

  public buildPagination(limit?: number, offset?: number) {
    if (limit === undefined && offset === undefined) {
      return null;
    }

    const parts: string[] = [];

    if (limit !== undefined) {
      parts.push(`LIMIT ${limit}`);
    }

    if (limit === undefined && offset !== undefined && offset > 0) {
      parts.push("LIMIT ALL");
    }

    if (offset !== undefined && offset > 0) {
      parts.push(`OFFSET ${offset}`);
    }

    return parts.length > 0 ? parts.join(" ") : null;
  }
}

import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";
import type {
  ColumnTypeMapping,
  DeleteOptions,
  Dialect,
  InsertOptions,
  QueryResult,
  SelectOptions,
  UpdateOptions,
} from "./types.js";

// MySQL dialect implementation.
// Fully implements all query building and type conversion for MySQL databases.
// Uses ? placeholder syntax and BIGINT AUTO_INCREMENT for auto-incrementing primary keys.
export class MysqlDialect implements Dialect {
  public readonly name = "mysql";

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
    return value.replace(/'/g, "''");
  }

  private formatDefaultValue(kind: ColumnKind, value: unknown): string {
    if (kind === "number" && typeof value === "number") {
      return String(value);
    }

    if (kind === "boolean" && typeof value === "boolean") {
      return value ? "1" : "0";
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
  ): QueryResult {
    const parts: string[] = [];
    const params: unknown[] = [];

    // SELECT clause
    const columnList = columns.join(", ");
    parts.push(`SELECT ${columnList} FROM ${tableName}`);

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

    return {
      sql: parts.join(" "),
      params,
    };
  }

  public buildInsert(options: InsertOptions): QueryResult {
    const columns = Object.keys(options.values);
    const placeholders = columns.map(() => "?").join(", ");
    const columnList = columns.join(", ");

    const sql = `INSERT INTO ${options.tableName} (${columnList}) VALUES (${placeholders})`;
    const params = Object.values(options.values);

    return { sql, params };
  }

  public buildUpdate(options: UpdateOptions): QueryResult {
    const columns = Object.keys(options.values);
    const setClause = columns.map((col) => `${col} = ?`).join(", ");

    const sql = `UPDATE ${options.tableName} SET ${setClause} WHERE ${options.where.text}`;
    const params = [...Object.values(options.values), ...options.where.values];

    return { sql, params };
  }

  public buildDelete(options: DeleteOptions): QueryResult {
    const sql = `DELETE FROM ${options.tableName} WHERE ${options.where.text}`;
    const params = [...options.where.values];

    return { sql, params };
  }

  public buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(table: Table<Columns>) {
    const columnDefs: string[] = [];
    const constraints: string[] = [];

    for (const [_key, column] of Object.entries(table.columns)) {
      const parts: string[] = [column.sqlName];

      // For primary keys, use BIGINT AUTO_INCREMENT (MySQL best practice)
      if (column.meta.primaryKey && column.columnKind === "number") {
        parts.push("BIGINT AUTO_INCREMENT PRIMARY KEY");
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
    return ok(`CREATE TABLE IF NOT EXISTS ${table.sqlName} (${allDefs})`);
  }

  public convertBooleanValue(value: unknown): boolean {
    // MySQL can return booleans as 1/0 or as native booleans
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value === 1;
    }
    // Fallback for edge cases
    return Boolean(value);
  }

  public buildPagination(limit?: number, offset?: number): string | null {
    if (limit === undefined && offset === undefined) {
      return null;
    }

    const parts: string[] = [];

    if (limit === undefined && offset !== undefined && offset > 0) {
      const maxLimit = "18446744073709551615";
      parts.push(`LIMIT ${maxLimit}`);
    }

    if (limit !== undefined) {
      parts.push(`LIMIT ${limit}`);
    }

    if (offset !== undefined && offset > 0) {
      parts.push(`OFFSET ${offset}`);
    }

    return parts.length > 0 ? parts.join(" ") : null;
  }
}

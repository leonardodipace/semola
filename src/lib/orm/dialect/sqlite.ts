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

// SQLite dialect implementation.
// Fully implements all query building and type conversion for SQLite databases.
export class SqliteDialect implements Dialect {
  public readonly name = "sqlite" as const;

  public readonly types: ColumnTypeMapping = {
    number: "INTEGER",
    string: "TEXT",
    boolean: "INTEGER", // SQLite stores booleans as 0/1
    date: "INTEGER", // SQLite stores dates as Unix timestamps
    json: "TEXT", // SQLite stores JSON as text
    jsonb: "TEXT", // SQLite stores JSONB as text (no distinction)
    uuid: "TEXT", // SQLite stores UUIDs as text
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

    const sql = `INSERT INTO ${options.tableName} (${columnList}) VALUES (${placeholders}) RETURNING *`;
    const params = Object.values(options.values);

    return { sql, params };
  }

  public buildUpdate(options: UpdateOptions): QueryResult {
    const columns = Object.keys(options.values);
    const setClause = columns.map((col) => `${col} = ?`).join(", ");

    const sql = `UPDATE ${options.tableName} SET ${setClause} WHERE ${options.where.text} RETURNING *`;
    const params = [...Object.values(options.values), ...options.where.values];

    return { sql, params };
  }

  public buildDelete(options: DeleteOptions): QueryResult {
    const sql = `DELETE FROM ${options.tableName} WHERE ${options.where.text} RETURNING *`;
    const params = [...options.where.values];

    return { sql, params };
  }

  public buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(table: Table<Columns>): string {
    const columnDefs: string[] = [];
    const constraints: string[] = [];

    for (const [_key, column] of Object.entries(table.columns)) {
      const sqlType = this.types[column.columnKind];
      if (!sqlType) {
        throw new Error(`Unsupported column type: ${column.columnKind}`);
      }
      const parts: string[] = [column.sqlName, sqlType];

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

      columnDefs.push(parts.join(" "));
    }

    const allDefs = [...columnDefs, ...constraints].join(", ");
    return `CREATE TABLE IF NOT EXISTS ${table.sqlName} (${allDefs})`;
  }

  public convertBooleanValue(value: unknown): boolean {
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

  public buildPagination(limit?: number, offset?: number): string | null {
    if (limit === undefined && offset === undefined) {
      return null;
    }

    if (limit !== undefined && offset !== undefined) {
      return `LIMIT ${limit} OFFSET ${offset}`;
    }

    if (limit !== undefined) {
      return `LIMIT ${limit}`;
    }

    if (offset !== undefined && offset > 0) {
      // SQLite uses LIMIT -1 to mean "no limit"
      return `LIMIT -1 OFFSET ${offset}`;
    }

    return null;
  }
}

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

// PostgreSQL dialect implementation.
// Fully implements all query building and type conversion for PostgreSQL databases.
// Uses $1, $2, $3 placeholder syntax and BIGSERIAL for auto-incrementing primary keys.
export class PostgresDialect implements Dialect {
  public readonly name = "postgres" as const;

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
  private toPostgresPlaceholders(sql: string, paramCount: number): string {
    let result = sql;
    for (let i = paramCount; i > 0; i--) {
      // Replace from end to start to avoid replacing already replaced placeholders
      result = result.replace("?", `$${i}`);
    }
    return result;
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

    const sql = this.toPostgresPlaceholders(parts.join(" "), params.length);
    return { sql, params };
  }

  public buildInsert(options: InsertOptions): QueryResult {
    const columns = Object.keys(options.values);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const columnList = columns.join(", ");

    const sql = `INSERT INTO ${options.tableName} (${columnList}) VALUES (${placeholders}) RETURNING *`;
    const params = Object.values(options.values);

    return { sql, params };
  }

  public buildUpdate(options: UpdateOptions): QueryResult {
    const columns = Object.keys(options.values);
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(", ");

    const whereClause = this.toPostgresPlaceholders(
      options.where.text,
      options.where.values.length,
    );

    // Adjust where clause placeholders to account for SET clause params
    const adjustedWhereClause = whereClause.replace(
      /\$(\d+)/g,
      (_, num) => `$${Number.parseInt(num, 10) + columns.length}`,
    );

    const sql = `UPDATE ${options.tableName} SET ${setClause} WHERE ${adjustedWhereClause} RETURNING *`;
    const params = [...Object.values(options.values), ...options.where.values];

    return { sql, params };
  }

  public buildDelete(options: DeleteOptions): QueryResult {
    const whereClause = this.toPostgresPlaceholders(
      options.where.text,
      options.where.values.length,
    );

    const sql = `DELETE FROM ${options.tableName} WHERE ${whereClause} RETURNING *`;
    const params = [...options.where.values];

    return { sql, params };
  }

  public buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(table: Table<Columns>): string {
    const columnDefs: string[] = [];
    const constraints: string[] = [];

    for (const [_key, column] of Object.entries(table.columns)) {
      const parts: string[] = [column.sqlName];

      // For primary keys, use BIGSERIAL (auto-incrementing 64-bit integer)
      if (column.meta.primaryKey && column.columnKind === "number") {
        parts.push("BIGSERIAL PRIMARY KEY");
      } else {
        const sqlType = this.types[column.columnKind];
        if (!sqlType) {
          throw new Error(`Unsupported column type: ${column.columnKind}`);
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
      }

      columnDefs.push(parts.join(" "));
    }

    const allDefs = [...columnDefs, ...constraints].join(", ");
    return `CREATE TABLE IF NOT EXISTS ${table.sqlName} (${allDefs})`;
  }

  public convertBooleanValue(value: unknown): boolean {
    // Postgres returns native booleans
    if (typeof value === "boolean") {
      return value;
    }
    // Fallback for edge cases
    return Boolean(value);
  }

  public buildPagination(limit?: number, offset?: number): string | null {
    if (limit === undefined && offset === undefined) {
      return null;
    }

    const parts: string[] = [];

    if (limit !== undefined) {
      parts.push(`LIMIT ${limit}`);
    }

    if (offset !== undefined && offset > 0) {
      parts.push(`OFFSET ${offset}`);
    }

    return parts.length > 0 ? parts.join(" ") : null;
  }
}

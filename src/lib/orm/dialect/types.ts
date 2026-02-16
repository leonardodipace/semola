import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";

// Represents an SQL query fragment that can be composed with other fragments.
export type QueryFragment = {
  readonly text: string;
  readonly values: unknown[];
};

// Options for building a SELECT query.
export type SelectOptions = {
  where?: QueryFragment | null;
  limit?: number;
  offset?: number;
};

// Options for building an INSERT query.
export type InsertOptions = {
  tableName: string;
  values: Record<string, unknown>;
};

// Options for building an UPDATE query.
export type UpdateOptions = {
  tableName: string;
  values: Record<string, unknown>;
  where: QueryFragment;
};

// Options for building a DELETE query.
export type DeleteOptions = {
  tableName: string;
  where: QueryFragment;
};

// Result of building a query with the dialect.
export type QueryResult = {
  readonly sql: string;
  readonly params: unknown[];
};

// Maps column types to database-specific SQL types.
export type ColumnTypeMapping = {
  number: string;
  string: string;
  boolean: string;
  date: string;
  json?: string;
  jsonb?: string;
  uuid?: string;
};

// Database dialect interface implementing the Strategy pattern.
// Each database (SQLite, Postgres, MySQL) implements this interface.
export interface Dialect {
  // The dialect name.
  readonly name: "sqlite" | "postgres" | "mysql";

  // SQL type mappings for this dialect.
  readonly types: ColumnTypeMapping;

  // Build a SELECT query for the given table and options.
  buildSelect(
    tableName: string,
    columns: string[],
    options: SelectOptions,
  ): QueryResult;

  // Build an INSERT query that returns the inserted row.
  buildInsert(options: InsertOptions): QueryResult;

  // Build an UPDATE query that returns the updated rows.
  buildUpdate(options: UpdateOptions): QueryResult;

  // Build a DELETE query that returns a count of deleted rows.
  buildDelete(options: DeleteOptions): QueryResult;

  // Build a CREATE TABLE statement for the given table definition.
  buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(table: Table<Columns>): string;

  // Convert a raw database value for a boolean column to a JavaScript boolean.
  // SQLite stores booleans as 0/1, while Postgres/MySQL support native booleans.
  convertBooleanValue(value: unknown): boolean;

  // Build pagination clause (LIMIT/OFFSET).
  buildPagination(limit?: number, offset?: number): string | null;
}

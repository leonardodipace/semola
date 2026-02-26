import type { Table } from "../table/index.js";

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

  // Build a CREATE TABLE statement for the given table definition.
  // Returns [error, null] on unsupported column type or [null, sql] on success.
  buildCreateTable(
    table: Table,
  ):
    | readonly [{ type: string; message: string }, null]
    | readonly [null, string];

  // SQL expression to auto-generate a UUID (e.g. "gen_random_uuid()").
  // null if the dialect has no built-in UUID function.
  readonly uuidFunction: string | null;

  // Convert a raw database value for a boolean column to a JavaScript boolean.
  // SQLite stores booleans as 0/1, while Postgres/MySQL support native booleans.
  convertBooleanValue(value: unknown): boolean;
}

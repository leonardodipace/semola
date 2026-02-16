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

// PostgreSQL dialect implementation (stub - not yet implemented).
// This is a placeholder for future PostgreSQL support.
export class PostgresDialect implements Dialect {
  public readonly name = "postgres" as const;

  public readonly types: ColumnTypeMapping = {
    number: "INTEGER",
    string: "TEXT",
    boolean: "BOOLEAN",
    date: "TIMESTAMP",
  };

  public buildSelect(
    _tableName: string,
    _columns: string[],
    _options: SelectOptions,
  ): QueryResult {
    throw new Error("PostgreSQL dialect not yet implemented");
  }

  public buildInsert(_options: InsertOptions): QueryResult {
    throw new Error("PostgreSQL dialect not yet implemented");
  }

  public buildUpdate(_options: UpdateOptions): QueryResult {
    throw new Error("PostgreSQL dialect not yet implemented");
  }

  public buildDelete(_options: DeleteOptions): QueryResult {
    throw new Error("PostgreSQL dialect not yet implemented");
  }

  public buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(_table: Table<Columns>): string {
    throw new Error("PostgreSQL dialect not yet implemented");
  }

  public convertBooleanValue(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    throw new Error("PostgreSQL dialect not yet implemented");
  }

  public buildPagination(_limit?: number, _offset?: number): string | null {
    throw new Error("PostgreSQL dialect not yet implemented");
  }
}

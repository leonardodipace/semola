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

// MySQL dialect implementation (stub - not yet implemented).
// This is a placeholder for future MySQL support.
export class MysqlDialect implements Dialect {
  public readonly name = "mysql" as const;

  public readonly types: ColumnTypeMapping = {
    number: "INT",
    string: "VARCHAR(255)",
    boolean: "BOOLEAN",
    date: "DATETIME",
    json: "JSON",
    jsonb: "JSON", // MySQL doesn't distinguish JSONB, uses JSON
    uuid: "CHAR(36)", // MySQL stores UUIDs as CHAR(36)
  };

  public buildSelect(
    _tableName: string,
    _columns: string[],
    _options: SelectOptions,
  ): QueryResult {
    throw new Error("MySQL dialect not yet implemented");
  }

  public buildInsert(_options: InsertOptions): QueryResult {
    throw new Error("MySQL dialect not yet implemented");
  }

  public buildUpdate(_options: UpdateOptions): QueryResult {
    throw new Error("MySQL dialect not yet implemented");
  }

  public buildDelete(_options: DeleteOptions): QueryResult {
    throw new Error("MySQL dialect not yet implemented");
  }

  public buildCreateTable<
    Columns extends Record<string, Column<ColumnKind, ColumnMeta>>,
  >(_table: Table<Columns>): string {
    throw new Error("MySQL dialect not yet implemented");
  }

  public convertBooleanValue(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    throw new Error("MySQL dialect not yet implemented");
  }

  public buildPagination(_limit?: number, _offset?: number): string | null {
    throw new Error("MySQL dialect not yet implemented");
  }
}

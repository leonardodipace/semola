import { err, ok } from "../../errors/index.js";
import {
  boolean,
  type Column,
  date,
  json,
  jsonb,
  number,
  string,
  uuid,
} from "../column/index.js";
import type { ColumnKind, ColumnMeta, ColumnValue } from "../column/types.js";
import type { Orm } from "../core/index.js";
import type { OrmDialect } from "../core/types.js";
import { Table } from "../table/index.js";
import { toSqlIdentifier, toSqlIdentifierList } from "./sql.js";

type AnyColumn = Column<ColumnKind, ColumnMeta>;

class ColumnBuilder<Kind extends ColumnKind> {
  private value: Column<Kind, ColumnMeta>;
  private readonly onChange: (column: Column<Kind, ColumnMeta>) => void;

  public constructor(
    column: Column<Kind, ColumnMeta>,
    onChange: (column: Column<Kind, ColumnMeta>) => void,
  ) {
    this.value = column;
    this.onChange = onChange;
    this.onChange(column);
  }

  public primaryKey() {
    this.value = this.value.primaryKey();
    this.onChange(this.value);
    return this;
  }

  public notNull() {
    this.value = this.value.notNull();
    this.onChange(this.value);
    return this;
  }

  public unique() {
    this.value = this.value.unique();
    this.onChange(this.value);
    return this;
  }

  public default(value: ColumnValue<Kind>) {
    this.value = this.value.default(value);
    this.onChange(this.value);
    return this;
  }
}

class TableBuilder {
  private readonly columnsMap: Record<string, AnyColumn> = {};

  private add<Kind extends ColumnKind>(column: Column<Kind, ColumnMeta>) {
    return new ColumnBuilder(column, (updated) => {
      this.columnsMap[updated.sqlName] = updated;
    });
  }

  public number(sqlName: string) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error) {
      throw new Error(error.message);
    }
    return this.add(number(safeName));
  }

  public string(sqlName: string) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error) {
      throw new Error(error.message);
    }
    return this.add(string(safeName));
  }

  public boolean(sqlName: string) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error) {
      throw new Error(error.message);
    }
    return this.add(boolean(safeName));
  }

  public date(sqlName: string) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error) {
      throw new Error(error.message);
    }
    return this.add(date(safeName));
  }

  public json(sqlName: string) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error) {
      throw new Error(error.message);
    }
    return this.add(json(safeName));
  }

  public jsonb(sqlName: string) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error) {
      throw new Error(error.message);
    }
    return this.add(jsonb(safeName));
  }

  public uuid(sqlName: string) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error) {
      throw new Error(error.message);
    }
    return this.add(uuid(safeName));
  }

  public get columns() {
    return this.columnsMap;
  }
}

const escapeString = (value: string) => {
  return value.replace(/'/g, "''");
};

const quoteValue = (dialect: OrmDialect, kind: ColumnKind, value: unknown) => {
  if (kind === "number" && typeof value === "number") {
    return String(value);
  }

  if (kind === "boolean" && typeof value === "boolean") {
    if (dialect === "sqlite") {
      return value ? "1" : "0";
    }
    return value ? "true" : "false";
  }

  if (kind === "date") {
    if (dialect === "sqlite") {
      if (value instanceof Date) {
        return String(value.getTime());
      }
      return String(value);
    }

    if (value instanceof Date) {
      return `'${escapeString(value.toISOString())}'`;
    }

    return `'${escapeString(String(value))}'`;
  }

  if (kind === "json" || kind === "jsonb") {
    let jsonValue: string;
    if (typeof value === "string") {
      jsonValue = value;
    } else {
      try {
        jsonValue = JSON.stringify(value) ?? "null";
      } catch (error) {
        if (error instanceof TypeError) {
          // Handle circular references
          const seen = new Set();
          const replacer = (_key: string, val: unknown) => {
            if (typeof val === "object" && val !== null) {
              if (seen.has(val)) {
                return null;
              }
              seen.add(val);
            }
            return val;
          };
          jsonValue = JSON.stringify(value, replacer) ?? "null";
        } else {
          throw error;
        }
      }
    }
    return `'${escapeString(jsonValue)}'`;
  }

  return `'${escapeString(String(value))}'`;
};

const sqlType = (dialect: OrmDialect, kind: ColumnKind) => {
  if (dialect === "postgres") {
    if (kind === "number") return "INTEGER";
    if (kind === "string") return "TEXT";
    if (kind === "boolean") return "BOOLEAN";
    if (kind === "date") return "TIMESTAMP";
    if (kind === "json") return "JSON";
    if (kind === "jsonb") return "JSONB";
    return "UUID";
  }

  if (dialect === "mysql") {
    if (kind === "number") return "INT";
    if (kind === "string") return "VARCHAR(255)";
    if (kind === "boolean") return "BOOLEAN";
    if (kind === "date") return "DATETIME";
    if (kind === "json" || kind === "jsonb") return "JSON";
    return "CHAR(36)";
  }

  if (kind === "number") return "INTEGER";
  if (kind === "string") return "TEXT";
  if (kind === "boolean") return "INTEGER";
  if (kind === "date") return "INTEGER";
  if (kind === "json" || kind === "jsonb") return "TEXT";
  return "TEXT";
};

const buildColumnDefinition = (dialect: OrmDialect, column: AnyColumn) => {
  const parts: string[] = [column.sqlName];

  if (column.meta.primaryKey && column.columnKind === "number") {
    if (dialect === "postgres") {
      parts.push("BIGSERIAL PRIMARY KEY");
      return parts.join(" ");
    }

    if (dialect === "mysql") {
      parts.push("BIGINT AUTO_INCREMENT PRIMARY KEY");
      return parts.join(" ");
    }

    parts.push("INTEGER PRIMARY KEY");
    return parts.join(" ");
  }

  parts.push(sqlType(dialect, column.columnKind));

  if (column.meta.primaryKey) {
    parts.push("PRIMARY KEY");
  }

  if (column.meta.notNull && !column.meta.primaryKey) {
    parts.push("NOT NULL");
  }

  if (column.meta.unique && !column.meta.primaryKey) {
    parts.push("UNIQUE");
  }

  if (column.meta.hasDefault && column.defaultValue !== undefined) {
    parts.push(
      `DEFAULT ${quoteValue(dialect, column.columnKind, column.defaultValue)}`,
    );
  }

  return parts.join(" ");
};

const normalizeColumn = (build: (t: TableBuilder) => unknown): AnyColumn => {
  const tableBuilder = new TableBuilder();
  build(tableBuilder);
  const values = Object.values(tableBuilder.columns);

  if (values.length === 0) {
    throw new Error("Expected exactly one column in migration operation");
  }

  if (values.length > 1) {
    throw new Error("Expected exactly one column in migration operation");
  }

  const column = values[0];
  if (!column) {
    throw new Error("Expected exactly one column in migration operation");
  }

  return column;
};

export class SchemaBuilder {
  private readonly orm: Orm<Record<string, Table>>;
  private readonly dialect: OrmDialect;
  private readonly sql: Bun.SQL;

  public constructor(
    orm: Orm<Record<string, Table>>,
    dialect: OrmDialect,
    sqlExecutor?: Bun.SQL,
  ) {
    this.orm = orm;
    this.dialect = dialect;
    this.sql = sqlExecutor ?? orm.sql;
  }

  private async execute(sql: string) {
    await this.sql.unsafe(sql);
  }

  public async createTable(name: string, build: (t: TableBuilder) => unknown) {
    const [error, safeTableName] = toSqlIdentifier(name, "table name");
    if (error) {
      return err("ValidationError", error.message);
    }
    const tableBuilder = new TableBuilder();
    build(tableBuilder);
    const table = new Table(safeTableName, tableBuilder.columns);
    const [createError, sql] = this.orm.createTable(table);
    if (createError) {
      return err("ValidationError", createError.message);
    }
    try {
      await this.execute(sql);
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }

  public async dropTable(name: string) {
    const [error, safeTableName] = toSqlIdentifier(name, "table name");
    if (error) {
      return err("ValidationError", error.message);
    }
    try {
      await this.execute(`DROP TABLE IF EXISTS ${safeTableName}`);
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }

  public async addColumn(
    tableName: string,
    build: (t: TableBuilder) => unknown,
  ) {
    const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
    if (error) {
      return err("ValidationError", error.message);
    }
    const column = normalizeColumn(build);
    const definition = buildColumnDefinition(this.dialect, column);
    try {
      await this.execute(
        `ALTER TABLE ${safeTableName} ADD COLUMN ${definition}`,
      );
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }

  public async dropColumn(tableName: string, columnName: string) {
    const [tableError, safeTableName] = toSqlIdentifier(
      tableName,
      "table name",
    );
    if (tableError) {
      return err("ValidationError", tableError.message);
    }
    const [columnError, safeColumnName] = toSqlIdentifier(
      columnName,
      "column name",
    );
    if (columnError) {
      return err("ValidationError", columnError.message);
    }
    try {
      await this.execute(
        `ALTER TABLE ${safeTableName} DROP COLUMN ${safeColumnName}`,
      );
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }

  public async alterColumn(
    tableName: string,
    columnName: string,
    build: (t: TableBuilder) => unknown,
  ) {
    const [tableError, safeTableName] = toSqlIdentifier(
      tableName,
      "table name",
    );
    if (tableError) {
      return err("ValidationError", tableError.message);
    }
    const [columnError, safeColumnName] = toSqlIdentifier(
      columnName,
      "column name",
    );
    if (columnError) {
      return err("ValidationError", columnError.message);
    }
    const column = normalizeColumn(build);

    if (this.dialect === "sqlite") {
      return err("ValidationError", "alterColumn is not supported for sqlite");
    }

    try {
      if (this.dialect === "mysql") {
        const definition = buildColumnDefinition(this.dialect, column);
        await this.execute(
          `ALTER TABLE ${safeTableName} MODIFY COLUMN ${definition}`,
        );
        return ok(true);
      }

      // PostgreSQL: wrap in transaction for atomicity
      if (this.dialect === "postgres") {
        await this.execute("BEGIN");

        try {
          const typeSql = sqlType(this.dialect, column.columnKind);
          await this.execute(
            `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} TYPE ${typeSql}`,
          );

          if (column.meta.notNull) {
            await this.execute(
              `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} SET NOT NULL`,
            );
          } else {
            await this.execute(
              `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} DROP NOT NULL`,
            );
          }

          if (column.meta.hasDefault && column.defaultValue !== undefined) {
            await this.execute(
              `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} SET DEFAULT ${quoteValue(this.dialect, column.columnKind, column.defaultValue)}`,
            );
          } else {
            await this.execute(
              `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} DROP DEFAULT`,
            );
          }

          await this.execute("COMMIT");
          return ok(true);
        } catch (innerError) {
          await this.execute("ROLLBACK");
          throw innerError;
        }
      }

      // Fallback for other dialects
      await this.execute("BEGIN");
      try {
        const typeSql = sqlType(this.dialect, column.columnKind);
        await this.execute(
          `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} TYPE ${typeSql}`,
        );

        if (column.meta.notNull) {
          await this.execute(
            `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} SET NOT NULL`,
          );
        } else {
          await this.execute(
            `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} DROP NOT NULL`,
          );
        }

        if (column.meta.hasDefault && column.defaultValue !== undefined) {
          await this.execute(
            `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} SET DEFAULT ${quoteValue(this.dialect, column.columnKind, column.defaultValue)}`,
          );
        } else {
          await this.execute(
            `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} DROP DEFAULT`,
          );
        }

        await this.execute("COMMIT");
      } catch (innerError) {
        await this.execute("ROLLBACK");
        throw innerError;
      }
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }

  public async createIndex(
    tableName: string,
    columns: string[],
    options?: { name?: string; unique?: boolean },
  ) {
    const [tableError, safeTableName] = toSqlIdentifier(
      tableName,
      "table name",
    );
    if (tableError) {
      return err("ValidationError", tableError.message);
    }
    const [columnsError, safeColumns] = toSqlIdentifierList(
      columns,
      "column name",
    );
    if (columnsError) {
      return err("ValidationError", columnsError.message);
    }
    const indexName =
      options?.name ??
      `${safeTableName}_${safeColumns.join("_")}${options?.unique ? "_uniq" : "_idx"}`;
    const [indexError, safeIndexName] = toSqlIdentifier(
      indexName,
      "index name",
    );
    if (indexError) {
      return err("ValidationError", indexError.message);
    }
    const uniqueKeyword = options?.unique ? "UNIQUE " : "";
    const ifNotExists = this.dialect === "mysql" ? "" : "IF NOT EXISTS ";
    try {
      await this.execute(
        `CREATE ${uniqueKeyword}INDEX ${ifNotExists}${safeIndexName} ON ${safeTableName} (${safeColumns.join(", ")})`,
      );
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }

  public async dropIndex(indexName: string, tableName?: string) {
    const [indexError, safeIndexName] = toSqlIdentifier(
      indexName,
      "index name",
    );
    if (indexError) {
      return err("ValidationError", indexError.message);
    }
    if (this.dialect === "mysql" && !tableName) {
      return err(
        "ValidationError",
        "tableName is required for DROP INDEX on mysql",
      );
    }
    try {
      if (this.dialect === "mysql" && tableName) {
        const [tableError, safeTableName] = toSqlIdentifier(
          tableName,
          "table name",
        );
        if (tableError) {
          return err("ValidationError", tableError.message);
        }
        await this.execute(`DROP INDEX ${safeIndexName} ON ${safeTableName}`);
        return ok(true);
      }

      await this.execute(`DROP INDEX IF EXISTS ${safeIndexName}`);
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }

  public async raw(sql: string) {
    try {
      await this.execute(sql);
      return ok(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err("InternalServerError", message);
    }
  }
}

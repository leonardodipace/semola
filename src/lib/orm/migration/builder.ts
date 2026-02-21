import { err, mightThrow, mightThrowSync, ok } from "../../errors/index.js";
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
  private _error: { type: string; message: string } | null = null;

  private setError(error: { type: string; message: string }) {
    if (!this._error) {
      this._error = error;
    }
  }

  private createNoopBuilder<Kind extends ColumnKind>(
    column: Column<Kind, ColumnMeta>,
  ) {
    return new ColumnBuilder(column, () => {});
  }

  private buildColumn<Kind extends ColumnKind>(
    sqlName: string,
    factory: (safeName: string) => Column<Kind, ColumnMeta>,
  ) {
    const [error, safeName] = toSqlIdentifier(sqlName, "column name");
    if (error || !safeName) {
      this.setError(
        error ?? {
          type: "ValidationError",
          message: `Invalid column: ${sqlName}`,
        },
      );
      return this.createNoopBuilder(factory("invalid_column"));
    }

    if (this._error) {
      return this.createNoopBuilder(factory(safeName));
    }

    return this.add(factory(safeName));
  }

  private add<Kind extends ColumnKind>(column: Column<Kind, ColumnMeta>) {
    return new ColumnBuilder(column, (updated) => {
      this.columnsMap[updated.sqlName] = updated;
    });
  }

  public number(sqlName: string) {
    return this.buildColumn(sqlName, number);
  }

  public string(sqlName: string) {
    return this.buildColumn(sqlName, string);
  }

  public boolean(sqlName: string) {
    return this.buildColumn(sqlName, boolean);
  }

  public date(sqlName: string) {
    return this.buildColumn(sqlName, date);
  }

  public json(sqlName: string) {
    return this.buildColumn(sqlName, json);
  }

  public jsonb(sqlName: string) {
    return this.buildColumn(sqlName, jsonb);
  }

  public uuid(sqlName: string) {
    return this.buildColumn(sqlName, uuid);
  }

  public get error() {
    return this._error;
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
    return ok(String(value));
  }

  if (kind === "boolean" && typeof value === "boolean") {
    if (dialect === "sqlite") {
      return ok(value ? "1" : "0");
    }
    return ok(value ? "true" : "false");
  }

  if (kind === "date") {
    if (dialect === "sqlite") {
      if (value instanceof Date) {
        return ok(String(value.getTime()));
      }
      return ok(String(value));
    }

    if (value instanceof Date) {
      return ok(`'${escapeString(value.toISOString())}'`);
    }

    return ok(`'${escapeString(String(value))}'`);
  }

  if (kind === "json" || kind === "jsonb") {
    let jsonValue: string;
    if (typeof value === "string") {
      jsonValue = value;
    } else {
      const [jsonError, stringified] = mightThrowSync(() => {
        return JSON.stringify(value) ?? "null";
      });

      if (jsonError) {
        if (!(jsonError instanceof TypeError)) {
          return err("InternalServerError", toMsg(jsonError));
        }

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

        const [safeError, safeStringified] = mightThrowSync(() => {
          return JSON.stringify(value, replacer) ?? "null";
        });
        if (safeError) {
          return err("InternalServerError", toMsg(safeError));
        }

        jsonValue = safeStringified ?? "null";
      } else {
        jsonValue = stringified ?? "null";
      }
    }
    return ok(`'${escapeString(jsonValue)}'`);
  }

  return ok(`'${escapeString(String(value))}'`);
};

const toMsg = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
      return ok(parts.join(" "));
    }

    if (dialect === "mysql") {
      parts.push("BIGINT AUTO_INCREMENT PRIMARY KEY");
      return ok(parts.join(" "));
    }

    parts.push("INTEGER PRIMARY KEY");
    return ok(parts.join(" "));
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
    const [quoteError, quotedValue] = quoteValue(
      dialect,
      column.columnKind,
      column.defaultValue,
    );
    if (quoteError) {
      return err(quoteError.type, quoteError.message);
    }

    parts.push(`DEFAULT ${quotedValue}`);
  }

  return ok(parts.join(" "));
};

const normalizeColumn = (build: (t: TableBuilder) => unknown) => {
  const tableBuilder = new TableBuilder();
  const [buildError] = mightThrowSync(() => {
    build(tableBuilder);
  });
  if (buildError) {
    return err("ValidationError", toMsg(buildError));
  }

  if (tableBuilder.error) {
    return err(tableBuilder.error.type, tableBuilder.error.message);
  }

  const values = Object.values(tableBuilder.columns);

  if (values.length === 0) {
    return err(
      "ValidationError",
      "Expected exactly one column in migration operation",
    );
  }

  if (values.length > 1) {
    return err(
      "ValidationError",
      "Expected exactly one column in migration operation",
    );
  }

  const column = values[0];
  if (!column) {
    return err(
      "ValidationError",
      "Expected exactly one column in migration operation",
    );
  }

  return ok(column);
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
    const [buildError] = mightThrowSync(() => {
      build(tableBuilder);
    });
    if (buildError) {
      return err("ValidationError", toMsg(buildError));
    }

    if (tableBuilder.error) {
      return err(tableBuilder.error.type, tableBuilder.error.message);
    }

    const table = new Table(safeTableName, tableBuilder.columns);
    const [createError, sql] = this.orm.createTable(table);
    if (createError) {
      return err("ValidationError", createError.message);
    }
    const [executeError] = await mightThrow(this.execute(sql));
    if (executeError) {
      return err("InternalServerError", toMsg(executeError));
    }

    return ok(true);
  }

  public async dropTable(name: string) {
    const [error, safeTableName] = toSqlIdentifier(name, "table name");
    if (error) {
      return err("ValidationError", error.message);
    }
    const [executeError] = await mightThrow(
      this.execute(`DROP TABLE IF EXISTS ${safeTableName}`),
    );
    if (executeError) {
      return err("InternalServerError", toMsg(executeError));
    }

    return ok(true);
  }

  public async addColumn(
    tableName: string,
    build: (t: TableBuilder) => unknown,
  ) {
    const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
    if (error) {
      return err("ValidationError", error.message);
    }
    const [normalizedColumnError, column] = normalizeColumn(build);
    if (normalizedColumnError || !column) {
      return err(
        normalizedColumnError?.type ?? "ValidationError",
        normalizedColumnError?.message ??
          "Expected exactly one column in migration operation",
      );
    }

    const [definitionError, definition] = buildColumnDefinition(
      this.dialect,
      column,
    );
    if (definitionError || !definition) {
      return err(
        definitionError?.type ?? "ValidationError",
        definitionError?.message ?? "Failed to build column definition",
      );
    }

    const [executeError] = await mightThrow(
      this.execute(`ALTER TABLE ${safeTableName} ADD COLUMN ${definition}`),
    );
    if (executeError) {
      return err("InternalServerError", toMsg(executeError));
    }

    return ok(true);
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
    const [executeError] = await mightThrow(
      this.execute(
        `ALTER TABLE ${safeTableName} DROP COLUMN ${safeColumnName}`,
      ),
    );
    if (executeError) {
      return err("InternalServerError", toMsg(executeError));
    }

    return ok(true);
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
    const [normalizedColumnError, column] = normalizeColumn(build);
    if (normalizedColumnError || !column) {
      return err(
        normalizedColumnError?.type ?? "ValidationError",
        normalizedColumnError?.message ??
          "Expected exactly one column in migration operation",
      );
    }

    if (this.dialect === "sqlite") {
      return err("ValidationError", "alterColumn is not supported for sqlite");
    }

    if (this.dialect === "mysql") {
      const [definitionError, definition] = buildColumnDefinition(
        this.dialect,
        column,
      );
      if (definitionError || !definition) {
        return err(
          definitionError?.type ?? "ValidationError",
          definitionError?.message ?? "Failed to build column definition",
        );
      }

      const [executeError] = await mightThrow(
        this.execute(
          `ALTER TABLE ${safeTableName} MODIFY COLUMN ${definition}`,
        ),
      );
      if (executeError) {
        return err("InternalServerError", toMsg(executeError));
      }

      return ok(true);
    }

    const runAlterStatements = async (
      executeStatement: (statement: string) => Promise<unknown>,
    ) => {
      const typeSql = sqlType(this.dialect, column.columnKind);
      const [typeError] = await mightThrow(
        executeStatement(
          `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} TYPE ${typeSql}`,
        ),
      );
      if (typeError) {
        return err("InternalServerError", toMsg(typeError));
      }

      const nullStatement = column.meta.notNull
        ? `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} SET NOT NULL`
        : `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} DROP NOT NULL`;

      const [nullError] = await mightThrow(executeStatement(nullStatement));
      if (nullError) {
        return err("InternalServerError", toMsg(nullError));
      }

      let defaultStatement = `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} DROP DEFAULT`;
      if (column.meta.hasDefault && column.defaultValue !== undefined) {
        const [quoteError, quotedValue] = quoteValue(
          this.dialect,
          column.columnKind,
          column.defaultValue,
        );
        if (quoteError || !quotedValue) {
          return err(
            quoteError?.type ?? "InternalServerError",
            quoteError?.message ?? "Failed to quote default value",
          );
        }

        defaultStatement = `ALTER TABLE ${safeTableName} ALTER COLUMN ${safeColumnName} SET DEFAULT ${quotedValue}`;
      }

      const [defaultError] = await mightThrow(
        executeStatement(defaultStatement),
      );
      if (defaultError) {
        return err("InternalServerError", toMsg(defaultError));
      }

      return ok(true);
    };

    const savepoint =
      this.sql !== this.orm.sql ? Reflect.get(this.sql, "savepoint") : null;

    if (typeof savepoint === "function") {
      const [savepointError] = await mightThrow(
        Promise.resolve(
          savepoint.call(this.sql, async (sp: Bun.SQL) => {
            const [alterError] = await runAlterStatements(async (statement) => {
              await sp.unsafe(statement);
            });

            if (alterError) {
              return err("InternalServerError", alterError.message);
            }

            return ok(true);
          }),
        ),
      );

      if (savepointError) {
        return err("InternalServerError", "Failed to create savepoint");
      }

      return ok(true);
    }

    const [transactionError] = await mightThrow(
      (async () => {
        await this.execute("BEGIN");
        const [alterError] = await runAlterStatements(async (statement) => {
          await this.execute(statement);
        });

        if (alterError) {
          await this.execute("ROLLBACK");
          return err("InternalServerError", alterError.message);
        }

        await this.execute("COMMIT");
        return ok(true);
      })(),
    );

    if (transactionError) {
      return err("InternalServerError", toMsg(transactionError));
    }

    return ok(true);
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
    const [executeError] = await mightThrow(
      this.execute(
        `CREATE ${uniqueKeyword}INDEX ${ifNotExists}${safeIndexName} ON ${safeTableName} (${safeColumns.join(", ")})`,
      ),
    );
    if (executeError) {
      return err("InternalServerError", toMsg(executeError));
    }

    return ok(true);
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
    if (this.dialect === "mysql" && tableName) {
      const [tableError, safeTableName] = toSqlIdentifier(
        tableName,
        "table name",
      );
      if (tableError) {
        return err("ValidationError", tableError.message);
      }

      const [dropOnTableError] = await mightThrow(
        this.execute(`DROP INDEX ${safeIndexName} ON ${safeTableName}`),
      );
      if (dropOnTableError) {
        return err("InternalServerError", toMsg(dropOnTableError));
      }

      return ok(true);
    }

    const [dropError] = await mightThrow(
      this.execute(`DROP INDEX IF EXISTS ${safeIndexName}`),
    );
    if (dropError) {
      return err("InternalServerError", toMsg(dropError));
    }

    return ok(true);
  }

  public async raw(sql: string) {
    const [executeError] = await mightThrow(this.execute(sql));
    if (executeError) {
      return err("InternalServerError", toMsg(executeError));
    }

    return ok(true);
  }
}

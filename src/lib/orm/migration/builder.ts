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
    return this.add(number(sqlName));
  }

  public string(sqlName: string) {
    return this.add(string(sqlName));
  }

  public boolean(sqlName: string) {
    return this.add(boolean(sqlName));
  }

  public date(sqlName: string) {
    return this.add(date(sqlName));
  }

  public json(sqlName: string) {
    return this.add(json(sqlName));
  }

  public jsonb(sqlName: string) {
    return this.add(jsonb(sqlName));
  }

  public uuid(sqlName: string) {
    return this.add(uuid(sqlName));
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
    const jsonValue =
      typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
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

const normalizeColumn = (build: (t: TableBuilder) => unknown) => {
  const tableBuilder = new TableBuilder();
  build(tableBuilder);
  const values = Object.values(tableBuilder.columns);
  const first = values[0];

  if (!first) {
    throw new Error("Expected at least one column in migration operation");
  }

  return first;
};

export class SchemaBuilder {
  private readonly orm: Orm<Record<string, Table>>;
  private readonly dialect: OrmDialect;

  public constructor(orm: Orm<Record<string, Table>>, dialect: OrmDialect) {
    this.orm = orm;
    this.dialect = dialect;
  }

  private async execute(sql: string) {
    await this.orm.sql.unsafe(sql);
  }

  public async createTable(name: string, build: (t: TableBuilder) => unknown) {
    const tableBuilder = new TableBuilder();
    build(tableBuilder);
    const table = new Table(name, tableBuilder.columns);
    const sql = this.orm.createTable(table);
    await this.execute(sql);
  }

  public async dropTable(name: string) {
    await this.execute(`DROP TABLE IF EXISTS ${name}`);
  }

  public async addColumn(
    tableName: string,
    build: (t: TableBuilder) => unknown,
  ) {
    const column = normalizeColumn(build);
    const definition = buildColumnDefinition(this.dialect, column);
    await this.execute(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }

  public async dropColumn(tableName: string, columnName: string) {
    await this.execute(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  }

  public async alterColumn(
    tableName: string,
    columnName: string,
    build: (t: TableBuilder) => unknown,
  ) {
    const column = normalizeColumn(build);

    if (this.dialect === "sqlite") {
      throw new Error("alterColumn is not supported for sqlite");
    }

    if (this.dialect === "mysql") {
      const definition = buildColumnDefinition(this.dialect, column);
      await this.execute(
        `ALTER TABLE ${tableName} MODIFY COLUMN ${definition}`,
      );
      return;
    }

    const typeSql = sqlType(this.dialect, column.columnKind);
    await this.execute(
      `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE ${typeSql}`,
    );

    if (column.meta.notNull) {
      await this.execute(
        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET NOT NULL`,
      );
    } else {
      await this.execute(
        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP NOT NULL`,
      );
    }

    if (column.meta.hasDefault && column.defaultValue !== undefined) {
      await this.execute(
        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET DEFAULT ${quoteValue(this.dialect, column.columnKind, column.defaultValue)}`,
      );
    } else {
      await this.execute(
        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT`,
      );
    }
  }

  public async createIndex(
    tableName: string,
    columns: string[],
    options?: { name?: string; unique?: boolean },
  ) {
    const indexName =
      options?.name ??
      `${tableName}_${columns.join("_")}${options?.unique ? "_uniq" : "_idx"}`;
    const uniqueKeyword = options?.unique ? "UNIQUE " : "";
    await this.execute(
      `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns.join(", ")})`,
    );
  }

  public async dropIndex(indexName: string, tableName?: string) {
    if (this.dialect === "mysql" && tableName) {
      await this.execute(`DROP INDEX ${indexName} ON ${tableName}`);
      return;
    }

    await this.execute(`DROP INDEX IF EXISTS ${indexName}`);
  }

  public async raw(sql: string) {
    await this.execute(sql);
  }
}

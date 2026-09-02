import { MigrationError } from "../../errors.js";
import type { IndexSnapshot } from "../../indexes/types.js";
import { quoteIdentifier } from "../../utils.js";
import type {
  ColumnSnapshot,
  MigrationDialectSpec,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "../types.js";
import { orderOps } from "./order.js";
import { dataLossWarnings } from "./warnings.js";

const enumCheckSql = (column: ColumnSnapshot) => {
  if (!column.enumValues?.length) return undefined;

  const list = column.enumValues
    .map((value) => `'${value.replaceAll("'", "''")}'`)
    .join(", ");

  return `CHECK (${quoteIdentifier(column.name)} IN (${list}))`;
};

export class MigrationDialect {
  public readonly name;
  private spec: MigrationDialectSpec;

  public constructor(spec: MigrationDialectSpec) {
    this.spec = spec;
    this.name = spec.name;
  }

  public async prepareConnection(sql: Bun.SQL) {
    await this.spec.prepareConnection?.(sql);
  }

  public async assertForeignKeys(sql: Bun.SQL) {
    await this.spec.assertForeignKeys?.(sql);
  }

  public async lockMigrations(sql: Bun.SQL) {
    await this.spec.lockMigrations?.(sql);
  }

  public beginMigration<T>(sql: Bun.SQL, fn: (tx: Bun.SQL) => Promise<T>) {
    if (this.spec.beginMigration) {
      return this.spec.beginMigration(sql, fn);
    }

    return sql.begin(fn);
  }

  public placeholders(count: number) {
    return Array.from({ length: count }, (_, index) => {
      return this.spec.formatPlaceholder(index + 1);
    }).join(", ");
  }

  public normalizeOps(
    from: SchemaSnapshot,
    to: SchemaSnapshot,
    ops: MigrationOp[],
  ) {
    if (!this.spec.normalizeOps) {
      return ops;
    }

    return this.spec.normalizeOps(from, to, ops);
  }

  public render(ops: MigrationOp[]) {
    const ordered = orderOps(ops, this.spec.deferCircularForeignKeys);
    const warnings = dataLossWarnings(ordered);
    let warningBlock = "";

    if (warnings.length > 0) {
      warningBlock = `${warnings.join("\n")}\n\n`;
    }

    const body = ordered
      .map((op) => this.renderOp(op))
      .filter((sql) => sql.length > 0)
      .join("\n\n");

    return `${warningBlock}${body}\n`;
  }

  private sqlTypeFor(column: ColumnSnapshot) {
    const override = this.spec.sqlTypeFor?.(column);

    if (override !== undefined) {
      return override;
    }

    if (column.sqlType === "uuid") {
      return this.spec.uuidType;
    }

    return this.spec.sqlTypes[column.type];
  }

  private renderHelpers() {
    return {
      sqlTypeFor: (column: ColumnSnapshot) => this.sqlTypeFor(column),
      formatDefault: (value: string) => this.spec.formatDefault(value),
      enumCheckSql,
    };
  }

  private renderColumnDef(
    constraintTable: string,
    column: ColumnSnapshot,
    inlinePrimaryKey = true,
  ) {
    const parts: string[] = [this.sqlTypeFor(column)];

    if (column.isPrimaryKey) {
      if (inlinePrimaryKey) {
        parts.push(
          `CONSTRAINT ${quoteIdentifier(`${constraintTable}_pkey`)} PRIMARY KEY`,
        );
      }
    }

    if (!column.isNullable) {
      parts.push("NOT NULL");
    }

    if (column.isUnique) {
      if (!column.isPrimaryKey) {
        parts.push(
          `CONSTRAINT ${quoteIdentifier(`${constraintTable}_${column.name}_key`)} UNIQUE`,
        );
      }
    }

    if (column.dbDefault !== undefined) {
      parts.push(`DEFAULT ${this.spec.formatDefault(column.dbDefault)}`);
    }

    const check = enumCheckSql(column);

    if (check) {
      parts.push(
        `CONSTRAINT ${quoteIdentifier(`${constraintTable}_${column.name}_check`)} ${check}`,
      );
    }

    if (column.references) {
      parts.push(
        `CONSTRAINT ${quoteIdentifier(`${constraintTable}_${column.name}_fkey`)} REFERENCES ${quoteIdentifier(column.references.table)} (${quoteIdentifier(column.references.column)})`,
      );
    }

    return `${quoteIdentifier(column.name)} ${parts.join(" ")}`;
  }

  private renderCreateTable(
    table: TableSnapshot,
    options?: { asName?: string },
  ) {
    const tableName = options?.asName ?? table.name;
    const constraintTable = table.name;
    const pkColumns = Object.values(table.columns).filter((column) => {
      return column.isPrimaryKey;
    });
    const compositePk = pkColumns.length > 1;
    const lines = Object.values(table.columns).map((column) => {
      return `    ${this.renderColumnDef(constraintTable, column, !compositePk)}`;
    });

    if (compositePk) {
      const cols = pkColumns
        .map((column) => quoteIdentifier(column.name))
        .join(", ");

      lines.push(
        `    CONSTRAINT ${quoteIdentifier(`${constraintTable}_pkey`)} PRIMARY KEY (${cols})`,
      );
    }

    return `CREATE TABLE ${quoteIdentifier(tableName)} (\n${lines.join(",\n")}\n);`;
  }

  private renderDropTable(table: TableSnapshot) {
    return `DROP TABLE ${quoteIdentifier(table.name)};`;
  }

  private renderAddColumn(table: string, column: ColumnSnapshot) {
    return `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${this.renderColumnDef(table, column, false)};`;
  }

  private renderDropForeignKey(table: string, column: ColumnSnapshot) {
    return `ALTER TABLE ${quoteIdentifier(table)} DROP CONSTRAINT ${quoteIdentifier(`${table}_${column.name}_fkey`)};`;
  }

  private renderAddForeignKey(table: string, column: ColumnSnapshot) {
    if (!column.references) {
      throw new MigrationError(
        `Cannot add foreign key ${table}.${column.name} without a target`,
      );
    }

    return `ALTER TABLE ${quoteIdentifier(table)} ADD CONSTRAINT ${quoteIdentifier(`${table}_${column.name}_fkey`)} FOREIGN KEY (${quoteIdentifier(column.name)}) REFERENCES ${quoteIdentifier(column.references.table)} (${quoteIdentifier(column.references.column)});`;
  }

  private renderDropPrimaryKey(table: string) {
    return `ALTER TABLE ${quoteIdentifier(table)} DROP CONSTRAINT ${quoteIdentifier(`${table}_pkey`)};`;
  }

  private renderAddPrimaryKey(table: string, columns: string[]) {
    const cols = columns.map(quoteIdentifier).join(", ");

    return `ALTER TABLE ${quoteIdentifier(table)} ADD CONSTRAINT ${quoteIdentifier(`${table}_pkey`)} PRIMARY KEY (${cols});`;
  }

  private renderDropColumn(table: string, column: ColumnSnapshot) {
    return `ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(column.name)};`;
  }

  private renderCreateIndex(index: IndexSnapshot) {
    const unique = index.unique ? "UNIQUE " : "";
    const cols = index.columns.map(quoteIdentifier).join(", ");
    let sql = `CREATE ${unique}INDEX ${quoteIdentifier(index.name)}\n  ON ${quoteIdentifier(index.table)} (${cols})`;

    if (index.where !== undefined) {
      sql += `\n  WHERE ${index.where}`;
    }

    return `${sql};`;
  }

  private renderDropIndex(index: IndexSnapshot) {
    return `DROP INDEX ${quoteIdentifier(index.name)};`;
  }

  private renderRenameTable(op: Extract<MigrationOp, { kind: "renameTable" }>) {
    if (this.spec.renderRenameTable) {
      return this.spec.renderRenameTable(op);
    }

    return `ALTER TABLE ${quoteIdentifier(op.from)} RENAME TO ${quoteIdentifier(op.to)};`;
  }

  private renderRenameColumn(
    op: Extract<MigrationOp, { kind: "renameColumn" }>,
  ) {
    if (this.spec.renderRenameColumn) {
      return this.spec.renderRenameColumn(op);
    }

    return `ALTER TABLE ${quoteIdentifier(op.table)} RENAME COLUMN ${quoteIdentifier(op.from)} TO ${quoteIdentifier(op.to)};`;
  }

  private renderAlterColumn(
    table: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    if (!this.spec.renderAlterColumn) {
      throw new MigrationError(
        `${this.spec.name} cannot ALTER COLUMN ${table}.${to.name}`,
      );
    }

    return this.spec.renderAlterColumn(table, from, to, this.renderHelpers());
  }

  private castSelectColumn(quoted: string, column: ColumnSnapshot) {
    return `CAST(${quoted} AS ${this.sqlTypeFor(column)})`;
  }

  private renderSelectCopy(
    from: TableSnapshot,
    to: TableSnapshot,
    name: string,
  ) {
    const quoted = quoteIdentifier(name);
    const fromColumn = from.columns[name];
    const toColumn = to.columns[name];

    if (!fromColumn) return quoted;
    if (!toColumn) return quoted;

    if (fromColumn.type !== toColumn.type) {
      return this.castSelectColumn(quoted, toColumn);
    }

    if (fromColumn.sqlType !== toColumn.sqlType) {
      return this.castSelectColumn(quoted, toColumn);
    }

    return quoted;
  }

  private renderRecreateTable(from: TableSnapshot, to: TableSnapshot) {
    const tmpName = `${to.name}__semola_tmp`;
    const shared = Object.keys(to.columns).filter((name) => from.columns[name]);
    const cols = shared.map(quoteIdentifier).join(", ");
    const selectCols = shared
      .map((name) => this.renderSelectCopy(from, to, name))
      .join(", ");
    const lines = [this.renderCreateTable(to, { asName: tmpName })];

    if (shared.length > 0) {
      lines.push(
        `INSERT INTO ${quoteIdentifier(tmpName)} (${cols}) SELECT ${selectCols} FROM ${quoteIdentifier(from.name)};`,
      );
    }

    lines.push(this.renderDropTable(from));
    lines.push(
      `ALTER TABLE ${quoteIdentifier(tmpName)} RENAME TO ${quoteIdentifier(to.name)};`,
    );

    for (const index of Object.values(to.indexes)) {
      lines.push(this.renderCreateIndex(index));
    }

    return lines.join("\n");
  }

  private renderOp(op: MigrationOp): string {
    switch (op.kind) {
      case "createTable":
        return this.renderCreateTable(op.table);
      case "dropTable":
        return this.renderDropTable(op.table);
      case "addColumn":
        return this.renderAddColumn(op.table, op.column);
      case "dropColumn":
        return this.renderDropColumn(op.table, op.column);
      case "alterColumn":
        return this.renderAlterColumn(op.table, op.from, op.to);
      case "recreateTable":
        return this.renderRecreateTable(op.from, op.to);
      case "dropForeignKey":
        return this.renderDropForeignKey(op.table, op.column);
      case "addForeignKey":
        return this.renderAddForeignKey(op.table, op.column);
      case "dropPrimaryKey":
        return this.renderDropPrimaryKey(op.table);
      case "addPrimaryKey":
        return this.renderAddPrimaryKey(op.table, op.columns);
      case "renameTable":
        return this.renderRenameTable(op);
      case "renameColumn":
        return this.renderRenameColumn(op);
      case "createIndex":
        return this.renderCreateIndex(op.index);
      case "dropIndex":
        return this.renderDropIndex(op.index);
    }
  }
}

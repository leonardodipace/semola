import { MigrationError } from "../../errors.js";
import { quoteIdentifier } from "../../utils.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "../types.js";
import { orderOps } from "./order.js";
import { dataLossWarnings } from "./warnings.js";

export const SCHEMA_HEADER_PREFIX = "-- semola-schema:";

export abstract class MigrationDialect {
  public abstract readonly name: "sqlite" | "postgres";
  protected abstract readonly sqlTypes: Record<ColumnSnapshot["type"], string>;
  protected abstract readonly uuidType: string;

  protected abstract formatPlaceholder(index: number): string;

  public async prepareConnection(_sql: Bun.SQL) {}

  public async assertForeignKeys(_sql: Bun.SQL) {}

  public async lockMigrations(_sql: Bun.SQL) {}

  public beginMigration<T>(sql: Bun.SQL, fn: (tx: Bun.SQL) => Promise<T>) {
    return sql.begin(fn);
  }

  public placeholders(count: number) {
    return Array.from({ length: count }, (_, index) => {
      return this.formatPlaceholder(index + 1);
    }).join(", ");
  }

  protected sqlTypeFor(column: ColumnSnapshot) {
    if (column.sqlType === "uuid") {
      return this.uuidType;
    }

    return this.sqlTypes[column.type];
  }

  protected formatDefault(value: string) {
    return value;
  }

  public foldTableOps(
    fromTable: TableSnapshot,
    toTable: TableSnapshot,
    tableOps: MigrationOp[],
  ) {
    if (!this.shouldRecreate(tableOps)) {
      return tableOps;
    }

    return [
      {
        kind: "recreateTable" as const,
        from: fromTable,
        to: toTable,
      },
    ];
  }

  public expandOps(
    _from: SchemaSnapshot,
    _to: SchemaSnapshot,
    ops: MigrationOp[],
  ) {
    return ops;
  }

  public render(ops: MigrationOp[], schemaHeader?: SchemaSnapshot) {
    const ordered = orderOps(ops, this.deferCircularForeignKeys());
    const warnings = dataLossWarnings(ordered);
    const warningBlock = warnings.length ? `${warnings.join("\n")}\n\n` : "";
    const body = ordered
      .map((op) => this.renderOp(op))
      .filter((sql) => sql.length > 0)
      .join("\n\n");

    if (!schemaHeader) {
      return `${warningBlock}${body}\n`;
    }

    return `${SCHEMA_HEADER_PREFIX}${JSON.stringify(schemaHeader)}\n\n${warningBlock}${body}\n`;
  }

  protected shouldRecreate(_tableOps: MigrationOp[]) {
    return false;
  }

  protected deferCircularForeignKeys() {
    return false;
  }

  protected renderAlterColumn(
    table: string,
    _from: ColumnSnapshot,
    to: ColumnSnapshot,
  ): string {
    throw new MigrationError(
      `${this.name} cannot ALTER COLUMN ${table}.${to.name}`,
    );
  }

  protected enumCheckSql(column: ColumnSnapshot) {
    if (!column.enumValues?.length) return undefined;

    const list = column.enumValues
      .map((value) => `'${value.replaceAll("'", "''")}'`)
      .join(", ");

    return `CHECK (${quoteIdentifier(column.name)} IN (${list}))`;
  }

  private renderColumnDef(
    table: string,
    column: ColumnSnapshot,
    inlinePrimaryKey = true,
  ) {
    const parts: string[] = [this.sqlTypeFor(column)];

    if (column.isPrimaryKey) {
      if (inlinePrimaryKey) {
        parts.push(
          `CONSTRAINT ${quoteIdentifier(`${table}_pkey`)} PRIMARY KEY`,
        );
      }
    }

    if (!column.isNullable) {
      parts.push("NOT NULL");
    }

    if (column.isUnique && !column.isPrimaryKey) {
      parts.push(
        `CONSTRAINT ${quoteIdentifier(`${table}_${column.name}_key`)} UNIQUE`,
      );
    }

    if (column.dbDefault !== undefined) {
      parts.push(`DEFAULT ${this.formatDefault(column.dbDefault)}`);
    }

    const check = this.enumCheckSql(column);

    if (check) {
      parts.push(
        `CONSTRAINT ${quoteIdentifier(`${table}_${column.name}_check`)} ${check}`,
      );
    }

    if (column.references) {
      parts.push(
        `CONSTRAINT ${quoteIdentifier(`${table}_${column.name}_fkey`)} REFERENCES ${quoteIdentifier(column.references.table)} (${quoteIdentifier(column.references.column)})`,
      );
    }

    return `${quoteIdentifier(column.name)} ${parts.join(" ")}`;
  }

  private renderCreateTable(table: TableSnapshot) {
    const pkColumns = Object.values(table.columns).filter((column) => {
      return column.isPrimaryKey;
    });
    const compositePk = pkColumns.length > 1;
    const lines = Object.values(table.columns).map((column) => {
      return `    ${this.renderColumnDef(table.name, column, !compositePk)}`;
    });

    if (compositePk) {
      const cols = pkColumns
        .map((column) => quoteIdentifier(column.name))
        .join(", ");

      lines.push(
        `    CONSTRAINT ${quoteIdentifier(`${table.name}_pkey`)} PRIMARY KEY (${cols})`,
      );
    }

    return `CREATE TABLE ${quoteIdentifier(table.name)} (\n${lines.join(",\n")}\n);`;
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

  private renderRenameTable(from: string, to: string) {
    return `ALTER TABLE ${quoteIdentifier(from)} RENAME TO ${quoteIdentifier(to)};`;
  }

  private renderRenameColumn(table: string, from: string, to: string) {
    return `ALTER TABLE ${quoteIdentifier(table)} RENAME COLUMN ${quoteIdentifier(from)} TO ${quoteIdentifier(to)};`;
  }

  private renderRecreateTable(from: TableSnapshot, to: TableSnapshot) {
    const tmpName = `${to.name}__semola_tmp`;
    const shared = Object.keys(to.columns).filter((name) => from.columns[name]);
    const cols = shared.map(quoteIdentifier).join(", ");
    const lines = [this.renderCreateTable({ ...to, name: tmpName })];

    if (shared.length > 0) {
      lines.push(
        `INSERT INTO ${quoteIdentifier(tmpName)} (${cols}) SELECT ${cols} FROM ${quoteIdentifier(from.name)};`,
      );
    }

    lines.push(this.renderDropTable(from));
    lines.push(
      `ALTER TABLE ${quoteIdentifier(tmpName)} RENAME TO ${quoteIdentifier(to.name)};`,
    );

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
        return this.renderRenameTable(op.from, op.to);
      case "renameColumn":
        return this.renderRenameColumn(op.table, op.from, op.to);
    }
  }
}

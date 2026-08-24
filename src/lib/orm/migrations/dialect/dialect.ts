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

  protected foldTableOps(
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

  protected foldOpsByTable(
    from: SchemaSnapshot,
    to: SchemaSnapshot,
    ops: MigrationOp[],
  ) {
    const folded: MigrationOp[] = [];
    let currentTable: string | undefined;
    let buffer: MigrationOp[] = [];

    const flush = () => {
      if (!currentTable) return;

      const fromTable = from.tables[currentTable];
      const toTable = to.tables[currentTable];

      if (fromTable && toTable) {
        folded.push(...this.foldTableOps(fromTable, toTable, buffer));
      } else {
        folded.push(...buffer);
      }

      buffer = [];
      currentTable = undefined;
    };

    for (const op of ops) {
      if (op.kind === "createTable") {
        flush();
        folded.push(op);
        continue;
      }

      if (op.kind === "dropTable") {
        flush();
        folded.push(op);
        continue;
      }

      const table = this.opTableName(op);

      if (table !== currentTable) {
        flush();
        currentTable = table;
      }

      buffer.push(op);
    }

    flush();

    return folded;
  }

  private opTableName(op: MigrationOp) {
    if (op.kind === "createTable") return op.table.name;
    if (op.kind === "dropTable") return op.table.name;
    if (op.kind === "recreateTable") return op.to.name;
    if (op.kind === "renameTable") return op.to;
    if (op.kind === "addPrimaryKey") return op.table;
    if (op.kind === "dropPrimaryKey") return op.table;

    return op.table;
  }

  public normalizeOps(
    from: SchemaSnapshot,
    to: SchemaSnapshot,
    ops: MigrationOp[],
  ) {
    return this.foldOpsByTable(from, to, ops);
  }

  public render(ops: MigrationOp[]) {
    const ordered = orderOps(ops, this.deferCircularForeignKeys());
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
      parts.push(`DEFAULT ${this.formatDefault(column.dbDefault)}`);
    }

    const check = this.enumCheckSql(column);

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

  protected renderRenameTable(
    op: Extract<MigrationOp, { kind: "renameTable" }>,
  ) {
    return `ALTER TABLE ${quoteIdentifier(op.from)} RENAME TO ${quoteIdentifier(op.to)};`;
  }

  protected renderRenameColumn(
    op: Extract<MigrationOp, { kind: "renameColumn" }>,
  ) {
    return `ALTER TABLE ${quoteIdentifier(op.table)} RENAME COLUMN ${quoteIdentifier(op.from)} TO ${quoteIdentifier(op.to)};`;
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
    }
  }
}

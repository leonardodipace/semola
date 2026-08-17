import { MigrationError } from "../errors.js";
import { quoteIdentifier } from "../utils.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

const renameWarning = (table: string, dropped: string[], added: string[]) => {
  if (!dropped.length) return;
  if (!added.length) return;

  return `-- warning: "${table}" drops ${dropped.join(", ")} and adds ${added.join(", ")}; renames are drop+add and do not copy data`;
};

const notNullAddWarning = (table: string, column: ColumnSnapshot) => {
  if (column.isNullable) return;
  if (column.dbDefault !== undefined) return;

  return `-- warning: ADD COLUMN "${table}"."${column.name}" NOT NULL without default fails if the table has rows`;
};

const dataLossWarnings = (ops: MigrationOp[]) => {
  const warnings: string[] = [];
  const dropped = new Map<string, string[]>();
  const added = new Map<string, string[]>();

  const record = (
    map: Map<string, string[]>,
    table: string,
    column: string,
  ) => {
    map.set(table, [...(map.get(table) ?? []), column]);
  };

  for (const op of ops) {
    if (op.kind === "dropColumn") {
      record(dropped, op.table, op.column.name);
      continue;
    }

    if (op.kind === "addColumn") {
      record(added, op.table, op.column.name);

      const warning = notNullAddWarning(op.table, op.column);

      if (warning) warnings.push(warning);

      continue;
    }

    if (op.kind !== "recreateTable") continue;

    const warning = renameWarning(
      op.to.name,
      Object.keys(op.from.columns).filter((name) => !op.to.columns[name]),
      Object.keys(op.to.columns).filter((name) => !op.from.columns[name]),
    );

    if (warning) warnings.push(warning);

    for (const column of Object.values(op.to.columns)) {
      if (op.from.columns[column.name]) continue;

      const addWarning = notNullAddWarning(op.to.name, column);

      if (addWarning) warnings.push(addWarning);
    }
  }

  for (const [table, droppedCols] of dropped) {
    const warning = renameWarning(table, droppedCols, added.get(table) ?? []);

    if (warning) warnings.push(warning);
  }

  return warnings;
};

export abstract class MigrationDialect {
  public abstract readonly name: "sqlite" | "postgres";
  protected abstract readonly sqlTypes: Record<string, string>;
  protected abstract readonly uuidType: string;

  public abstract formatPlaceholder(index: number): string;

  public async prepareConnection(_sql: Bun.SQL) {}

  public async assertForeignKeys(_sql: Bun.SQL) {}

  public placeholders(count: number) {
    return Array.from({ length: count }, (_, index) => {
      return this.formatPlaceholder(index + 1);
    }).join(", ");
  }

  public sqlTypeFor(column: ColumnSnapshot) {
    if (column.sqlType === "uuid") {
      return this.uuidType;
    }

    return this.sqlTypes[column.type] ?? "TEXT";
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

  public render(ops: MigrationOp[], schemaHeader?: SchemaSnapshot) {
    const ordered = this.orderOps(ops);
    const warnings = dataLossWarnings(ordered);
    const warningBlock = warnings.length ? `${warnings.join("\n")}\n\n` : "";
    const body = ordered.map((op) => this.renderOp(op)).join("\n\n");

    if (!schemaHeader) {
      return `${warningBlock}${body}\n`;
    }

    return `-- semola-schema:${JSON.stringify(schemaHeader)}\n\n${warningBlock}${body}\n`;
  }

  protected shouldRecreate(_tableOps: MigrationOp[]) {
    return false;
  }

  protected renderAlterColumn(
    table: string,
    _from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
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

  private renderColumnDef(table: string, column: ColumnSnapshot) {
    const parts: string[] = [this.sqlTypeFor(column)];

    if (column.isPrimaryKey) {
      parts.push(`CONSTRAINT ${quoteIdentifier(`${table}_pkey`)} PRIMARY KEY`);
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
      parts.push(`DEFAULT ${column.dbDefault}`);
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
    const lines = Object.values(table.columns).map((column) => {
      return `    ${this.renderColumnDef(table.name, column)}`;
    });

    return `CREATE TABLE ${quoteIdentifier(table.name)} (\n${lines.join(",\n")}\n);`;
  }

  private renderDropTable(table: TableSnapshot) {
    return `DROP TABLE ${quoteIdentifier(table.name)};`;
  }

  private renderAddColumn(table: string, column: ColumnSnapshot) {
    return `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${this.renderColumnDef(table, column)};`;
  }

  private renderDropColumn(table: string, column: ColumnSnapshot) {
    return `ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(column.name)};`;
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

  private renderOp(op: MigrationOp) {
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
    }
  }

  private sortTables(tables: TableSnapshot[]) {
    const byName = new Map(tables.map((table) => [table.name, table]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: TableSnapshot[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;

      if (visiting.has(name)) {
        throw new MigrationError(`Circular foreign key involving ${name}`);
      }

      visiting.add(name);
      const table = byName.get(name);

      if (table) {
        for (const column of Object.values(table.columns)) {
          if (!column.references) continue;
          if (column.references.table === name) continue;
          if (!byName.has(column.references.table)) continue;

          visit(column.references.table);
        }

        ordered.push(table);
      }

      visiting.delete(name);
      visited.add(name);
    };

    for (const table of tables) {
      visit(table.name);
    }

    return ordered;
  }

  private orderOps(ops: MigrationOp[]) {
    const dropColumns: MigrationOp[] = [];
    const dropTables: TableSnapshot[] = [];
    const createTables: TableSnapshot[] = [];
    const recreates: MigrationOp[] = [];
    const addColumns: MigrationOp[] = [];
    const alters: MigrationOp[] = [];

    for (const op of ops) {
      if (op.kind === "dropColumn") {
        dropColumns.push(op);
        continue;
      }

      if (op.kind === "dropTable") {
        dropTables.push(op.table);
        continue;
      }

      if (op.kind === "createTable") {
        createTables.push(op.table);
        continue;
      }

      if (op.kind === "recreateTable") {
        recreates.push(op);
        continue;
      }

      if (op.kind === "addColumn") {
        addColumns.push(op);
        continue;
      }

      alters.push(op);
    }

    const sortedDrops = this.sortTables(dropTables)
      .reverse()
      .map((table) => {
        return { kind: "dropTable" as const, table };
      });

    const sortedCreates = this.sortTables(createTables).map((table) => {
      return { kind: "createTable" as const, table };
    });

    const dropPrimaryKeys: MigrationOp[] = [];
    const addPrimaryKeys: MigrationOp[] = [];
    const otherAlters: MigrationOp[] = [];

    for (const op of alters) {
      if (
        op.kind === "alterColumn" &&
        op.from.isPrimaryKey &&
        !op.to.isPrimaryKey
      ) {
        dropPrimaryKeys.push(op);
        continue;
      }

      if (
        op.kind === "alterColumn" &&
        !op.from.isPrimaryKey &&
        op.to.isPrimaryKey
      ) {
        addPrimaryKeys.push(op);
        continue;
      }

      otherAlters.push(op);
    }

    return [
      ...dropColumns,
      ...sortedCreates,
      ...dropPrimaryKeys,
      ...otherAlters,
      ...addPrimaryKeys,
      ...recreates,
      ...sortedDrops,
      ...addColumns,
    ];
  }
}

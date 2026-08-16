import { quoteIdentifier } from "../utils.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

export abstract class MigrationDialect {
  public abstract readonly name: "sqlite" | "postgres";
  protected abstract readonly sqlTypes: Record<string, string>;
  protected abstract readonly uuidType: string;

  public abstract formatPlaceholder(index: number): string;

  public async prepareConnection(_sql: Bun.SQL) {}

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
    const body = ordered.map((op) => this.renderOp(op)).join("\n\n");

    if (!schemaHeader) {
      return `${body}\n`;
    }

    return `-- semola-schema:${JSON.stringify(schemaHeader)}\n\n${body}\n`;
  }

  protected shouldRecreate(_tableOps: MigrationOp[]) {
    return false;
  }

  protected renderAlterColumn(
    table: string,
    _from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    throw new Error(`${this.name} cannot ALTER COLUMN ${table}.${to.name}`);
  }

  protected enumCheckSql(column: ColumnSnapshot) {
    if (!column.enumValues?.length) return undefined;

    const list = column.enumValues
      .map((value) => `'${value.replaceAll("'", "''")}'`)
      .join(", ");

    return `CHECK (${quoteIdentifier(column.name)} IN (${list}))`;
  }

  private renderColumnDef(column: ColumnSnapshot, forCreateTable: boolean) {
    const parts: string[] = [this.sqlTypeFor(column)];

    if (column.isPrimaryKey && forCreateTable) {
      parts.push("PRIMARY KEY");
    }

    if (!column.isNullable) {
      parts.push("NOT NULL");
    }

    if (column.isUnique && !column.isPrimaryKey) {
      parts.push("UNIQUE");
    }

    if (column.dbDefault !== undefined) {
      parts.push(`DEFAULT ${column.dbDefault}`);
    }

    const check = this.enumCheckSql(column);

    if (check) {
      parts.push(check);
    }

    if (column.references) {
      parts.push(
        `REFERENCES ${quoteIdentifier(column.references.table)} (${quoteIdentifier(column.references.column)})`,
      );
    }

    return `${quoteIdentifier(column.name)} ${parts.join(" ")}`;
  }

  private renderCreateTable(table: TableSnapshot) {
    const lines = Object.values(table.columns).map((column) => {
      return `    ${this.renderColumnDef(column, true)}`;
    });

    return `CREATE TABLE ${quoteIdentifier(table.name)} (\n${lines.join(",\n")}\n);`;
  }

  private renderDropTable(table: TableSnapshot) {
    return `DROP TABLE ${quoteIdentifier(table.name)};`;
  }

  private renderAddColumn(table: string, column: ColumnSnapshot) {
    return `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${this.renderColumnDef(column, false)};`;
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
      if (visiting.has(name)) return;

      visiting.add(name);
      const table = byName.get(name);

      if (table) {
        for (const column of Object.values(table.columns)) {
          if (!column.references) continue;
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

    return [
      ...dropColumns,
      ...sortedDrops,
      ...sortedCreates,
      ...recreates,
      ...addColumns,
      ...alters,
    ];
  }
}

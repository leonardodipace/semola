import { MigrationError } from "../errors.js";
import { quoteIdentifier } from "../utils.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

const KNOWN_DB_DEFAULTS = new Set([
  "NULL",
  "TRUE",
  "FALSE",
  "CURRENT_TIME",
  "CURRENT_DATE",
  "CURRENT_TIMESTAMP",
]);

const assertDbDefault = (expression: string, column: string) => {
  const trimmed = expression.trim();

  if (!trimmed) {
    throw new MigrationError(`Column ${column} has an empty dbDefault`);
  }

  if (/^['"0-9(+-]/.test(trimmed)) return;
  if (KNOWN_DB_DEFAULTS.has(trimmed.toUpperCase())) return;
  if (/^[A-Za-z_][\w$]*\(/.test(trimmed)) return;
  if (trimmed.includes("::")) return;

  throw new MigrationError(
    `Column ${column} dbDefault must be SQL (string literals need quotes: "'value'")`,
  );
};

const renameWarning = (table: string, dropped: string[], added: string[]) => {
  if (!dropped.length) return;
  if (!added.length) return;

  return `-- warning: "${table}" drops ${dropped.join(", ")} and adds ${added.join(", ")}; renames are drop+add and do not copy data`;
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
      continue;
    }

    if (op.kind !== "recreateTable") continue;

    const warning = renameWarning(
      op.to.name,
      Object.keys(op.from.columns).filter((name) => !op.to.columns[name]),
      Object.keys(op.to.columns).filter((name) => !op.from.columns[name]),
    );

    if (warning) warnings.push(warning);
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
    throw new Error(`${this.name} cannot ALTER COLUMN ${table}.${to.name}`);
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
    forCreateTable: boolean,
  ) {
    const parts: string[] = [this.sqlTypeFor(column)];

    if (column.isPrimaryKey && forCreateTable) {
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
      assertDbDefault(column.dbDefault, `${table}.${column.name}`);
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
      return `    ${this.renderColumnDef(table.name, column, true)}`;
    });

    return `CREATE TABLE ${quoteIdentifier(table.name)} (\n${lines.join(",\n")}\n);`;
  }

  private renderDropTable(table: TableSnapshot) {
    return `DROP TABLE ${quoteIdentifier(table.name)};`;
  }

  private renderAddColumn(table: string, column: ColumnSnapshot) {
    return `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${this.renderColumnDef(table, column, false)};`;
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

import { MigrationError } from "../../errors.js";
import { quoteIdentifier } from "../../utils.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "../types.js";

export const SCHEMA_HEADER_PREFIX = "-- semola-schema:";

const renameWarning = (table: string, dropped: string[], added: string[]) => {
  if (!dropped.length) return;
  if (!added.length) return;

  return `-- warning: "${table}" drops ${dropped.join(", ")} and adds ${added.join(", ")}; renames are drop+add and do not copy data`;
};

const isConstantDefault = (value?: string) => {
  if (value === undefined) return false;
  if (value === "TRUE") return true;
  if (value === "FALSE") return true;
  if (value.startsWith("'")) return true;

  return /^-?\d+(\.\d+)?$/.test(value);
};

const pushAddColumnWarnings = (
  warnings: string[],
  table: string,
  column: ColumnSnapshot,
) => {
  if (!column.isNullable) {
    if (column.dbDefault === undefined) {
      warnings.push(
        `-- warning: ADD COLUMN "${table}"."${column.name}" NOT NULL without default fails if the table has rows`,
      );
    }
  }

  if (!column.isUnique) {
    if (!column.isPrimaryKey) return;
  }

  if (!isConstantDefault(column.dbDefault)) return;

  warnings.push(
    `-- warning: ADD COLUMN "${table}"."${column.name}" unique/primary key with a constant default fails if the table has more than one row`,
  );
};

const dataLossWarnings = (ops: MigrationOp[]) => {
  const warnings: string[] = [];
  const dropped = new Map<string, string[]>();
  const added = new Map<string, string[]>();
  const droppedTables: string[] = [];
  const createdTables: string[] = [];

  const record = (
    map: Map<string, string[]>,
    table: string,
    column: string,
  ) => {
    const columns = map.get(table);

    if (columns) {
      columns.push(column);
      return;
    }

    map.set(table, [column]);
  };

  for (const op of ops) {
    if (op.kind === "dropTable") {
      droppedTables.push(op.table.name);
      continue;
    }

    if (op.kind === "createTable") {
      createdTables.push(op.table.name);
      continue;
    }

    if (op.kind === "dropColumn") {
      record(dropped, op.table, op.column.name);
      continue;
    }

    if (op.kind === "addColumn") {
      record(added, op.table, op.column.name);
      pushAddColumnWarnings(warnings, op.table, op.column);
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

      pushAddColumnWarnings(warnings, op.to.name, column);
    }
  }

  if (droppedTables.length) {
    if (createdTables.length) {
      warnings.push(
        `-- warning: drops table(s) ${droppedTables.join(", ")} and creates ${createdTables.join(", ")}; table renames are drop+create and do not copy data`,
      );
    } else {
      warnings.push(
        `-- warning: drops table(s) ${droppedTables.join(", ")}; data in those tables will be lost`,
      );
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
    const ordered = this.orderOps(ops);
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

  private withoutForeignKeys(table: TableSnapshot) {
    const columns: Record<string, ColumnSnapshot> = {};

    for (const column of Object.values(table.columns)) {
      const { references: _references, ...rest } = column;

      columns[column.name] = rest;
    }

    return { name: table.name, columns };
  }

  private foreignKeysOf(tables: TableSnapshot[]) {
    const ops: MigrationOp[] = [];

    for (const table of tables) {
      for (const column of Object.values(table.columns)) {
        if (!column.references) continue;

        ops.push({ kind: "addForeignKey", table: table.name, column });
      }
    }

    return ops;
  }

  private foreignKeysBetween(tables: TableSnapshot[]) {
    const names = new Set(tables.map((table) => table.name));
    const ops: MigrationOp[] = [];

    for (const table of tables) {
      for (const column of Object.values(table.columns)) {
        if (!column.references) continue;
        if (!names.has(column.references.table)) continue;

        ops.push({ kind: "dropForeignKey", table: table.name, column });
      }
    }

    return ops;
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
    }
  }

  private sortTables(tables: TableSnapshot[]) {
    const byName = new Map(tables.map((table) => [table.name, table]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: TableSnapshot[] = [];
    let cycle = false;

    const visit = (name: string) => {
      if (visited.has(name)) return;

      if (visiting.has(name)) {
        cycle = true;
        return;
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

    if (cycle) {
      return { ordered: tables, cycle: true };
    }

    return { ordered, cycle: false };
  }

  private orderOps(ops: MigrationOp[]) {
    const creates: TableSnapshot[] = [];
    const drops: TableSnapshot[] = [];
    const dropForeignKeys: MigrationOp[] = [];
    const dropColumns: MigrationOp[] = [];
    const dropPrimaryKeys: MigrationOp[] = [];
    const alterColumns: MigrationOp[] = [];
    const recreates: MigrationOp[] = [];
    const addColumns: MigrationOp[] = [];
    const addPrimaryKeys: MigrationOp[] = [];
    const addForeignKeys: MigrationOp[] = [];

    for (const op of ops) {
      switch (op.kind) {
        case "createTable":
          creates.push(op.table);
          break;
        case "dropTable":
          drops.push(op.table);
          break;
        case "dropForeignKey":
          dropForeignKeys.push(op);
          break;
        case "dropColumn":
          dropColumns.push(op);
          break;
        case "dropPrimaryKey":
          dropPrimaryKeys.push(op);
          break;
        case "alterColumn":
          alterColumns.push(op);
          break;
        case "recreateTable":
          recreates.push(op);
          break;
        case "addColumn":
          addColumns.push(op);
          break;
        case "addPrimaryKey":
          addPrimaryKeys.push(op);
          break;
        case "addForeignKey":
          addForeignKeys.push(op);
          break;
      }
    }

    const sortedCreates = this.sortTables(creates);
    const sortedDrops = this.sortTables(drops);
    const deferCycles = this.deferCircularForeignKeys();
    const stripCreateFks = deferCycles && sortedCreates.cycle;
    const createOps = sortedCreates.ordered.map((table) => {
      return {
        kind: "createTable" as const,
        table: stripCreateFks ? this.withoutForeignKeys(table) : table,
      };
    });
    const dropOps = [...sortedDrops.ordered].reverse().map((table) => {
      return { kind: "dropTable" as const, table };
    });
    const cycleForeignKeys = stripCreateFks
      ? this.foreignKeysOf(sortedCreates.ordered)
      : [];
    const cycleDropForeignKeys =
      deferCycles && sortedDrops.cycle
        ? this.foreignKeysBetween(sortedDrops.ordered)
        : [];

    return [
      ...cycleDropForeignKeys,
      ...dropForeignKeys,
      ...dropColumns,
      ...createOps,
      ...dropPrimaryKeys,
      ...alterColumns,
      ...recreates,
      ...dropOps,
      ...addColumns,
      ...addPrimaryKeys,
      ...addForeignKeys,
      ...cycleForeignKeys,
    ];
  }
}

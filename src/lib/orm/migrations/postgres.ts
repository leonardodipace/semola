import { POSTGRES_SPEC } from "../dialect/postgres.js";
import { quoteIdentifier } from "../utils.js";
import { MigrationDialect } from "./dialect.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

const pkNames = (table: TableSnapshot) => {
  return Object.values(table.columns)
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name);
};

const typeOrKeyChanged = (from: ColumnSnapshot, to: ColumnSnapshot) => {
  if (from.type !== to.type) return true;
  if (from.sqlType !== to.sqlType) return true;
  if (from.isPrimaryKey !== to.isPrimaryKey) return true;
  if (from.isUnique !== to.isUnique) return true;

  return false;
};

const refsEqual = (
  a: ColumnSnapshot["references"],
  b: ColumnSnapshot["references"],
) => {
  if (a?.table !== b?.table) return false;
  if (a?.column !== b?.column) return false;

  return true;
};

const inboundForeignKeys = (
  schema: SchemaSnapshot,
  targetTable: string,
  targetColumn: string,
) => {
  const found: Array<{ table: string; column: ColumnSnapshot }> = [];

  for (const table of Object.values(schema.tables)) {
    for (const column of Object.values(table.columns)) {
      if (!column.references) continue;
      if (column.references.table !== targetTable) continue;
      if (column.references.column !== targetColumn) continue;

      found.push({ table: table.name, column });
    }
  }

  return found;
};

export class PostgresMigrationDialect extends MigrationDialect {
  public readonly name = "postgres" as const;
  protected readonly uuidType = "UUID";
  protected readonly sqlTypes = {
    string: "TEXT",
    enum: "TEXT",
    number: "DOUBLE PRECISION",
    boolean: "BOOLEAN",
    date: "TIMESTAMP",
    json: "JSON",
    jsonb: "JSONB",
  };

  public formatPlaceholder(index: number) {
    return POSTGRES_SPEC.formatPlaceholder(index);
  }

  public override async lockMigrations(sql: Bun.SQL) {
    await sql.unsafe(
      "SELECT pg_advisory_xact_lock(hashtext('_semola_migrations'))",
    );
  }

  protected override deferCircularForeignKeys() {
    return true;
  }

  public override expandOps(
    from: SchemaSnapshot,
    to: SchemaSnapshot,
    ops: MigrationOp[],
  ) {
    const drops: MigrationOp[] = [];
    const adds: MigrationOp[] = [];
    const pkDrops: MigrationOp[] = [];
    const pkAdds: MigrationOp[] = [];
    const seenDrop = new Set<string>();
    const seenAdd = new Set<string>();

    const queueDrop = (table: string, column: ColumnSnapshot) => {
      if (!column.references) return;

      const key = `${table}.${column.name}`;

      if (seenDrop.has(key)) return;

      seenDrop.add(key);
      drops.push({ kind: "dropForeignKey", table, column });
    };

    const queueAdd = (table: string, column: ColumnSnapshot) => {
      if (!column.references) return;

      const target = to.tables[column.references.table];

      if (!target) return;
      if (!target.columns[column.references.column]) return;

      const key = `${table}.${column.name}`;

      if (seenAdd.has(key)) return;

      seenAdd.add(key);
      adds.push({ kind: "addForeignKey", table, column });
    };

    const queueInbound = (targetTable: string, targetColumn: string) => {
      for (const inbound of inboundForeignKeys(
        from,
        targetTable,
        targetColumn,
      )) {
        queueDrop(inbound.table, inbound.column);

        const next = to.tables[inbound.table]?.columns[inbound.column.name];

        if (next) queueAdd(inbound.table, next);
      }
    };

    for (const op of ops) {
      if (op.kind === "alterColumn") {
        if (typeOrKeyChanged(op.from, op.to)) {
          queueDrop(op.table, op.from);
          queueAdd(op.table, op.to);
          queueInbound(op.table, op.from.name);
        }

        if (!refsEqual(op.from.references, op.to.references)) {
          queueDrop(op.table, op.from);
          queueAdd(op.table, op.to);
        }

        continue;
      }

      if (op.kind === "dropColumn") {
        queueInbound(op.table, op.column.name);
      }
    }

    for (const name of Object.keys(to.tables)) {
      const fromTable = from.tables[name];
      const toTable = to.tables[name];

      if (!fromTable) continue;
      if (!toTable) continue;
      if (
        ops.some((op) => {
          if (op.kind !== "recreateTable") return false;

          return op.to.name === name;
        })
      ) {
        continue;
      }

      const fromPk = pkNames(fromTable);
      const toPk = pkNames(toTable);

      if (fromPk.join("\0") === toPk.join("\0")) continue;

      if (fromPk.length) {
        pkDrops.push({ kind: "dropPrimaryKey", table: name });
      }

      if (toPk.length) {
        pkAdds.push({ kind: "addPrimaryKey", table: name, columns: toPk });
      }
    }

    return [...drops, ...pkDrops, ...ops, ...pkAdds, ...adds];
  }

  protected override renderAlterColumn(
    table: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    const statements: string[] = [];
    const tableId = quoteIdentifier(table);
    const columnId = quoteIdentifier(to.name);
    const alterColumn = (action: string) => {
      statements.push(
        `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} ${action};`,
      );
    };
    const typeChanged = from.type !== to.type || from.sqlType !== to.sqlType;

    if (typeChanged) {
      if (from.dbDefault !== undefined) {
        alterColumn("DROP DEFAULT");
      }

      if (from.enumValues?.length) {
        statements.push(
          `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(`${table}_${from.name}_check`)};`,
        );
      }

      const sqlType = this.sqlTypeFor(to);

      alterColumn(`TYPE ${sqlType} USING CAST(${columnId} AS ${sqlType})`);
    }

    this.pushUniqueChange(statements, table, tableId, columnId, from, to);

    if (from.isNullable !== to.isNullable) {
      alterColumn(to.isNullable ? "DROP NOT NULL" : "SET NOT NULL");
    }

    if (typeChanged) {
      if (to.dbDefault !== undefined) {
        alterColumn(`SET DEFAULT ${to.dbDefault}`);
      }
    } else if (from.dbDefault !== to.dbDefault) {
      if (to.dbDefault === undefined) {
        alterColumn("DROP DEFAULT");
      } else {
        alterColumn(`SET DEFAULT ${to.dbDefault}`);
      }
    }

    this.pushEnumCheckChange(statements, table, tableId, from, to);

    if (statements.length === 0) {
      return `-- no-op alter for ${table}.${to.name}`;
    }

    return statements.join("\n");
  }

  private jsonEqual(a: unknown, b: unknown) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private pushUniqueChange(
    statements: string[],
    table: string,
    tableId: string,
    columnId: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    const fromUnique = from.isUnique && !from.isPrimaryKey;
    const toUnique = to.isUnique && !to.isPrimaryKey;

    if (fromUnique === toUnique) return;

    if (toUnique) {
      statements.push(
        `ALTER TABLE ${tableId} ADD CONSTRAINT ${quoteIdentifier(`${table}_${to.name}_key`)} UNIQUE (${columnId});`,
      );
      return;
    }

    statements.push(
      `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(`${table}_${to.name}_key`)};`,
    );
  }

  private pushEnumCheckChange(
    statements: string[],
    table: string,
    tableId: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    const typeChanged = from.type !== to.type || from.sqlType !== to.sqlType;
    const enumChanged = !this.jsonEqual(from.enumValues, to.enumValues);

    if (!typeChanged) {
      if (!enumChanged) return;

      if (from.enumValues?.length) {
        statements.push(
          `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(`${table}_${to.name}_check`)};`,
        );
      }
    }

    const checkName = quoteIdentifier(`${table}_${to.name}_check`);
    const check = this.enumCheckSql(to);

    if (check) {
      statements.push(
        `ALTER TABLE ${tableId} ADD CONSTRAINT ${checkName} ${check};`,
      );
    }
  }
}

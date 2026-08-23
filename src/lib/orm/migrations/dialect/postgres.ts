import { POSTGRES_SPEC } from "../../dialect/postgres.js";
import { quoteIdentifier } from "../../utils.js";
import type { ColumnSnapshot, MigrationOp, SchemaSnapshot } from "../types.js";
import { MigrationDialect } from "./dialect.js";

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

  protected formatPlaceholder(index: number) {
    return POSTGRES_SPEC.formatPlaceholder(index);
  }

  protected override formatDefault(value: string) {
    if (value === "TRUE") return "true";
    if (value === "FALSE") return "false";

    return value;
  }

  public override async lockMigrations(sql: Bun.SQL) {
    // Fixed key pair reserved for Semola migrations (avoids hashtext collisions).
    await sql.unsafe("SELECT pg_advisory_xact_lock(872314055, 1)");
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

    for (const [tableName, fromTable] of Object.entries(from.tables)) {
      const toTable = to.tables[tableName];

      for (const fromCol of Object.values(fromTable.columns)) {
        const toCol = toTable?.columns[fromCol.name];

        if (!toCol) {
          queueInbound(tableName, fromCol.name);
          continue;
        }

        if (typeOrKeyChanged(fromCol, toCol)) {
          queueDrop(tableName, fromCol);
          queueAdd(tableName, toCol);
          queueInbound(tableName, fromCol.name);
        }

        if (!refsEqual(fromCol.references, toCol.references)) {
          queueDrop(tableName, fromCol);
          queueAdd(tableName, toCol);
        }
      }
    }

    return [...drops, ...ops, ...adds];
  }

  private renderConstraintRenames(
    table: string,
    constraints: Array<{ from: string; to: string }>,
  ) {
    return constraints.map((constraint) => {
      return `ALTER TABLE ${quoteIdentifier(table)} RENAME CONSTRAINT ${quoteIdentifier(constraint.from)} TO ${quoteIdentifier(constraint.to)};`;
    });
  }

  protected override renderRenameTable(
    op: Extract<MigrationOp, { kind: "renameTable" }>,
  ) {
    return [
      `ALTER TABLE ${quoteIdentifier(op.from)} RENAME TO ${quoteIdentifier(op.to)};`,
      ...this.renderConstraintRenames(op.to, op.constraints),
    ].join("\n");
  }

  protected override renderRenameColumn(
    op: Extract<MigrationOp, { kind: "renameColumn" }>,
  ) {
    return [
      `ALTER TABLE ${quoteIdentifier(op.table)} RENAME COLUMN ${quoteIdentifier(op.from)} TO ${quoteIdentifier(op.to)};`,
      ...this.renderConstraintRenames(op.table, op.constraints),
    ].join("\n");
  }

  protected override renderAlterColumn(
    table: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    const statements: string[] = [];
    const tableId = quoteIdentifier(table);
    const columnId = quoteIdentifier(to.name);
    const typeChanged = from.type !== to.type || from.sqlType !== to.sqlType;
    const fromUnique = from.isUnique && !from.isPrimaryKey;
    const toUnique = to.isUnique && !to.isPrimaryKey;
    const enumChanged =
      JSON.stringify(from.enumValues) !== JSON.stringify(to.enumValues);

    const alterColumn = (action: string) => {
      statements.push(
        `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} ${action};`,
      );
    };

    const dropConstraint = (name: string) => {
      statements.push(
        `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(name)};`,
      );
    };

    const addConstraint = (name: string, body: string) => {
      statements.push(
        `ALTER TABLE ${tableId} ADD CONSTRAINT ${quoteIdentifier(name)} ${body};`,
      );
    };

    if (typeChanged) {
      if (from.dbDefault !== undefined) {
        alterColumn("DROP DEFAULT");
      }

      if (from.enumValues?.length) {
        dropConstraint(`${table}_${from.name}_check`);
      }

      const sqlType = this.sqlTypeFor(to);

      alterColumn(`TYPE ${sqlType} USING CAST(${columnId} AS ${sqlType})`);
    }

    if (fromUnique) {
      if (!toUnique) {
        dropConstraint(`${table}_${to.name}_key`);
      }
    }

    if (from.isNullable !== to.isNullable) {
      alterColumn(to.isNullable ? "DROP NOT NULL" : "SET NOT NULL");
    }

    if (!fromUnique) {
      if (toUnique) {
        addConstraint(`${table}_${to.name}_key`, `UNIQUE (${columnId})`);
      }
    }

    if (typeChanged) {
      if (to.dbDefault !== undefined) {
        alterColumn(`SET DEFAULT ${this.formatDefault(to.dbDefault)}`);
      }
    } else if (from.dbDefault !== to.dbDefault) {
      if (to.dbDefault === undefined) {
        alterColumn("DROP DEFAULT");
      } else {
        alterColumn(`SET DEFAULT ${this.formatDefault(to.dbDefault)}`);
      }
    }

    if (!typeChanged) {
      if (enumChanged) {
        if (from.enumValues?.length) {
          dropConstraint(`${table}_${to.name}_check`);
        }
      }
    }

    if (typeChanged || enumChanged) {
      const check = this.enumCheckSql(to);

      if (check) {
        addConstraint(`${table}_${to.name}_check`, check);
      }
    }

    if (statements.length === 0) {
      return "";
    }

    return statements.join("\n");
  }
}

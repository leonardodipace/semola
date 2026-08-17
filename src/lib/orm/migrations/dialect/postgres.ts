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

  protected override renderAlterColumn(
    table: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    const statements: string[] = [];
    const tableId = quoteIdentifier(table);
    const columnId = quoteIdentifier(to.name);
    const typeChanged = from.type !== to.type || from.sqlType !== to.sqlType;
    const alterColumn = (action: string) => {
      statements.push(
        `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} ${action};`,
      );
    };

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

    this.pushEnumCheckChange(statements, table, tableId, from, to, typeChanged);

    if (statements.length === 0) {
      return "";
    }

    return statements.join("\n");
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
    typeChanged: boolean,
  ) {
    const enumChanged =
      JSON.stringify(from.enumValues) !== JSON.stringify(to.enumValues);

    if (!typeChanged) {
      if (!enumChanged) return;

      if (from.enumValues?.length) {
        statements.push(
          `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(`${table}_${to.name}_check`)};`,
        );
      }
    }

    const check = this.enumCheckSql(to);

    if (check) {
      statements.push(
        `ALTER TABLE ${tableId} ADD CONSTRAINT ${quoteIdentifier(`${table}_${to.name}_check`)} ${check};`,
      );
    }
  }
}

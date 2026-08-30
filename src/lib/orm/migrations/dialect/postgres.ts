import { POSTGRES_SPEC } from "../../dialect/postgres.js";
import { quoteIdentifier } from "../../utils.js";
import type {
  ColumnSnapshot,
  MigrationDialectSpec,
  MigrationOp,
  MigrationRenderHelpers,
  SchemaSnapshot,
} from "../types.js";
import { foreignKeysOf, withoutForeignKeys } from "./order.js";

const sqlTypes = {
  string: "TEXT",
  enum: "TEXT",
  number: "DOUBLE PRECISION",
  boolean: "BOOLEAN",
  date: "TIMESTAMP",
  json: "JSON",
  jsonb: "JSONB",
} as const;

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

const formatDefault = (value: string) => {
  if (value === "TRUE") return "true";
  if (value === "FALSE") return "false";

  return value;
};

const lockMigrations = async (sql: Bun.SQL) => {
  // Fixed key pair reserved for Semola migrations (avoids hashtext collisions).
  await sql.unsafe("SELECT pg_advisory_xact_lock(872314055, 1)");
};

const deferInlineForeignKeys = (ops: MigrationOp[]) => {
  const rewritten: MigrationOp[] = [];
  const deferred: MigrationOp[] = [];

  for (const op of ops) {
    if (op.kind === "createTable") {
      deferred.push(...foreignKeysOf([op.table]));
      rewritten.push({
        kind: "createTable",
        table: withoutForeignKeys(op.table),
      });
      continue;
    }

    if (op.kind === "addColumn") {
      if (op.column.references) {
        deferred.push({
          kind: "addForeignKey",
          table: op.table,
          column: op.column,
        });

        const { references: _references, ...column } = op.column;

        rewritten.push({
          kind: "addColumn",
          table: op.table,
          column,
        });
        continue;
      }
    }

    rewritten.push(op);
  }

  return [...rewritten, ...deferred];
};

const expandForeignKeys = (
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  ops: MigrationOp[],
) => {
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
    for (const inbound of inboundForeignKeys(from, targetTable, targetColumn)) {
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
};

const normalizeOps = (
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  ops: MigrationOp[],
) => {
  return expandForeignKeys(from, to, deferInlineForeignKeys(ops));
};

const columnConstraintRenames = (
  fromTable: string,
  toTable: string,
  fromColumn: string,
  toColumn: string,
  column: ColumnSnapshot,
) => {
  const constraints: Array<{ from: string; to: string }> = [];

  if (column.isUnique) {
    if (!column.isPrimaryKey) {
      constraints.push({
        from: `${fromTable}_${fromColumn}_key`,
        to: `${toTable}_${toColumn}_key`,
      });
    }
  }

  if (column.enumValues?.length) {
    constraints.push({
      from: `${fromTable}_${fromColumn}_check`,
      to: `${toTable}_${toColumn}_check`,
    });
  }

  if (column.references) {
    constraints.push({
      from: `${fromTable}_${fromColumn}_fkey`,
      to: `${toTable}_${toColumn}_fkey`,
    });
  }

  return constraints;
};

const tableConstraintRenames = (
  from: string,
  to: string,
  columns: ColumnSnapshot[],
) => {
  const constraints: Array<{ from: string; to: string }> = [];

  if (columns.some((column) => column.isPrimaryKey)) {
    constraints.push({ from: `${from}_pkey`, to: `${to}_pkey` });
  }

  for (const column of columns) {
    constraints.push(
      ...columnConstraintRenames(from, to, column.name, column.name, column),
    );
  }

  return constraints;
};

const renderConstraintRenames = (
  table: string,
  constraints: Array<{ from: string; to: string }>,
) => {
  return constraints.map((constraint) => {
    return `ALTER TABLE ${quoteIdentifier(table)} RENAME CONSTRAINT ${quoteIdentifier(constraint.from)} TO ${quoteIdentifier(constraint.to)};`;
  });
};

const renderRenameTable = (
  op: Extract<MigrationOp, { kind: "renameTable" }>,
) => {
  return [
    `ALTER TABLE ${quoteIdentifier(op.from)} RENAME TO ${quoteIdentifier(op.to)};`,
    ...renderConstraintRenames(
      op.to,
      tableConstraintRenames(op.from, op.to, op.columns),
    ),
  ].join("\n");
};

const renderRenameColumn = (
  op: Extract<MigrationOp, { kind: "renameColumn" }>,
) => {
  return [
    `ALTER TABLE ${quoteIdentifier(op.table)} RENAME COLUMN ${quoteIdentifier(op.from)} TO ${quoteIdentifier(op.to)};`,
    ...renderConstraintRenames(
      op.table,
      columnConstraintRenames(op.table, op.table, op.from, op.to, op.column),
    ),
  ].join("\n");
};

const columnTypeChanged = (from: ColumnSnapshot, to: ColumnSnapshot) => {
  if (from.type !== to.type) return true;
  if (from.sqlType !== to.sqlType) return true;

  return false;
};

const hasStandaloneUnique = (column: ColumnSnapshot) => {
  if (!column.isUnique) return false;
  if (column.isPrimaryKey) return false;

  return true;
};

const enumValuesChanged = (from: ColumnSnapshot, to: ColumnSnapshot) => {
  return JSON.stringify(from.enumValues) !== JSON.stringify(to.enumValues);
};

const syncDefaultWithoutTypeChange = (
  from: ColumnSnapshot,
  to: ColumnSnapshot,
  alterColumn: (action: string) => void,
  formatDefaultValue: (value: string) => string,
) => {
  if (from.dbDefault === to.dbDefault) return;

  if (to.dbDefault === undefined) {
    alterColumn("DROP DEFAULT");
    return;
  }

  alterColumn(`SET DEFAULT ${formatDefaultValue(to.dbDefault)}`);
};

const renderAlterColumn = (
  table: string,
  from: ColumnSnapshot,
  to: ColumnSnapshot,
  helpers: MigrationRenderHelpers,
) => {
  const statements: string[] = [];
  const tableId = quoteIdentifier(table);
  const columnId = quoteIdentifier(to.name);
  const typeChanged = columnTypeChanged(from, to);
  const fromUnique = hasStandaloneUnique(from);
  const toUnique = hasStandaloneUnique(to);
  const enumChanged = enumValuesChanged(from, to);

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

    const sqlType = helpers.sqlTypeFor(to);

    alterColumn(`TYPE ${sqlType} USING CAST(${columnId} AS ${sqlType})`);
  }

  if (fromUnique) {
    if (!toUnique) {
      dropConstraint(`${table}_${to.name}_key`);
    }
  }

  if (from.isNullable !== to.isNullable) {
    if (to.isNullable) {
      alterColumn("DROP NOT NULL");
    } else {
      alterColumn("SET NOT NULL");
    }
  }

  if (!fromUnique) {
    if (toUnique) {
      addConstraint(`${table}_${to.name}_key`, `UNIQUE (${columnId})`);
    }
  }

  if (typeChanged) {
    if (to.dbDefault !== undefined) {
      alterColumn(`SET DEFAULT ${helpers.formatDefault(to.dbDefault)}`);
    }
  } else {
    syncDefaultWithoutTypeChange(from, to, alterColumn, helpers.formatDefault);
  }

  if (!typeChanged) {
    if (enumChanged) {
      if (from.enumValues?.length) {
        dropConstraint(`${table}_${to.name}_check`);
      }
    }
  }

  if (typeChanged || enumChanged) {
    const check = helpers.enumCheckSql(to);

    if (check) {
      addConstraint(`${table}_${to.name}_check`, check);
    }
  }

  if (statements.length === 0) {
    return "";
  }

  return statements.join("\n");
};

export const POSTGRES_MIGRATION_SPEC: MigrationDialectSpec = {
  name: "postgres",
  uuidType: "UUID",
  sqlTypes,
  formatPlaceholder: POSTGRES_SPEC.formatPlaceholder,
  formatDefault,
  deferCircularForeignKeys: true,
  normalizeOps,
  renderAlterColumn,
  renderRenameTable,
  renderRenameColumn,
  lockMigrations,
};

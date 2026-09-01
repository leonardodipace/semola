import { SQLITE_SPEC } from "../../dialect/sqlite.js";
import { MigrationError } from "../../errors.js";
import type {
  ColumnSnapshot,
  MigrationDialectSpec,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "../types.js";
import { isConstantDefault } from "./warnings.js";

const sqlTypes = {
  string: "TEXT",
  enum: "TEXT",
  number: "REAL",
  boolean: "INTEGER",
  date: "TEXT",
  json: "TEXT",
  jsonb: "TEXT",
} as const;

const formatDefault = (value: string) => {
  if (value === "TRUE") return "1";
  if (value === "FALSE") return "0";

  return value;
};

const sqlTypeFor = (column: ColumnSnapshot) => {
  if (column.type !== "number") return undefined;

  if (column.isPrimaryKey) {
    return "INTEGER";
  }

  return undefined;
};

const canAddColumnInPlace = (column: ColumnSnapshot) => {
  if (column.isPrimaryKey) return false;
  if (column.isUnique) return false;

  if (column.dbDefault !== undefined) {
    return isConstantDefault(column.dbDefault);
  }

  // SQLite ADD COLUMN without DEFAULT requires a nullable column.
  return column.isNullable;
};

const canDropColumnInPlace = (column: ColumnSnapshot) => {
  if (column.isPrimaryKey) return false;
  if (column.isUnique) return false;

  return true;
};

const canApplyInPlace = (op: MigrationOp) => {
  if (op.kind === "addColumn") {
    return canAddColumnInPlace(op.column);
  }

  if (op.kind === "dropColumn") {
    return canDropColumnInPlace(op.column);
  }

  return false;
};

const shouldRecreate = (tableOps: MigrationOp[]) => {
  if (tableOps.length === 0) return false;

  return !tableOps.every((op) => canApplyInPlace(op));
};

const opTableName = (op: MigrationOp) => {
  if (op.kind === "createTable") return op.table.name;
  if (op.kind === "dropTable") return op.table.name;
  if (op.kind === "recreateTable") return op.to.name;
  if (op.kind === "renameTable") return op.to;
  if (op.kind === "addPrimaryKey") return op.table;
  if (op.kind === "dropPrimaryKey") return op.table;

  return op.table;
};

const foldTableOps = (
  fromTable: TableSnapshot,
  toTable: TableSnapshot,
  tableOps: MigrationOp[],
) => {
  if (!shouldRecreate(tableOps)) {
    return tableOps;
  }

  return [
    {
      kind: "recreateTable" as const,
      from: fromTable,
      to: toTable,
    },
  ];
};

const foldOpsByTable = (
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  ops: MigrationOp[],
) => {
  const folded: MigrationOp[] = [];
  let currentTable: string | undefined;
  let buffer: MigrationOp[] = [];

  const flush = () => {
    if (!currentTable) return;

    const fromTable = from.tables[currentTable];
    const toTable = to.tables[currentTable];

    if (fromTable && toTable) {
      folded.push(...foldTableOps(fromTable, toTable, buffer));
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

    const table = opTableName(op);

    if (table !== currentTable) {
      flush();
      currentTable = table;
    }

    buffer.push(op);
  }

  flush();

  return folded;
};

const prepareConnection = async (sql: Bun.SQL) => {
  await sql.unsafe("PRAGMA foreign_keys = OFF");
  await sql.unsafe("PRAGMA busy_timeout = 250");
};

const assertForeignKeys = async (sql: Bun.SQL) => {
  const violations = [...(await sql.unsafe("PRAGMA foreign_key_check"))];

  if (violations.length === 0) return;

  throw new MigrationError(
    `Foreign key check failed (${violations.length} violation(s)): ${violations.map((row) => JSON.stringify(row)).join("; ")}`,
  );
};

export const SQLITE_MIGRATION_SPEC: MigrationDialectSpec = {
  name: "sqlite",
  uuidType: "TEXT",
  sqlTypes,
  formatPlaceholder: SQLITE_SPEC.formatPlaceholder,
  formatDefault,
  deferCircularForeignKeys: false,
  sqlTypeFor,
  normalizeOps: foldOpsByTable,
  prepareConnection,
  assertForeignKeys,
  beginMigration: (sql, fn) => sql.begin("IMMEDIATE", fn),
};

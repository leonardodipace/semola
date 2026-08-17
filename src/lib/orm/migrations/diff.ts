import type { Adapter } from "../dialect/types.js";
import { MigrationError } from "../errors.js";
import { getMigrationDialect } from "./sql.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

const columnsEqual = (a: ColumnSnapshot, b: ColumnSnapshot) => {
  if (a.name !== b.name) return false;
  if (a.type !== b.type) return false;
  if (a.sqlType !== b.sqlType) return false;
  if (a.isNullable !== b.isNullable) return false;
  if (a.isPrimaryKey !== b.isPrimaryKey) return false;
  if (a.isUnique !== b.isUnique) return false;
  if (a.dbDefault !== b.dbDefault) return false;
  if (a.enumValues?.length !== b.enumValues?.length) return false;

  if (a.enumValues) {
    if (b.enumValues) {
      for (let index = 0; index < a.enumValues.length; index++) {
        if (a.enumValues[index] !== b.enumValues[index]) return false;
      }
    }
  }

  if (a.references?.table !== b.references?.table) return false;
  if (a.references?.column !== b.references?.column) return false;

  return true;
};

const assertAddableColumn = (table: string, column: ColumnSnapshot) => {
  if (column.isNullable) return;
  if (column.dbDefault !== undefined) return;

  throw new MigrationError(
    `Cannot add NOT NULL column ${table}.${column.name} without .dbDefault(...)`,
  );
};

const diffTable = (
  name: string,
  fromTable: TableSnapshot,
  toTable: TableSnapshot,
  strictAddColumn: boolean,
) => {
  const tableOps: MigrationOp[] = [];

  for (const columnName of Object.keys(toTable.columns)) {
    const next = toTable.columns[columnName];
    const prev = fromTable.columns[columnName];

    if (!next) continue;

    if (!prev) {
      if (strictAddColumn) {
        assertAddableColumn(name, next);
      }

      tableOps.push({ kind: "addColumn", table: name, column: next });
      continue;
    }

    if (columnsEqual(prev, next)) continue;

    tableOps.push({
      kind: "alterColumn",
      table: name,
      from: prev,
      to: next,
    });
  }

  for (const columnName of Object.keys(fromTable.columns)) {
    if (toTable.columns[columnName]) continue;

    const column = fromTable.columns[columnName];

    if (!column) continue;

    tableOps.push({
      kind: "dropColumn",
      table: name,
      column,
    });
  }

  return tableOps;
};

const createdTables = (from: SchemaSnapshot, to: SchemaSnapshot) => {
  const ops: MigrationOp[] = [];

  for (const name of Object.keys(to.tables)) {
    const table = to.tables[name];

    if (!table) continue;
    if (from.tables[name]) continue;

    ops.push({ kind: "createTable", table });
  }

  return ops;
};

const droppedTables = (from: SchemaSnapshot, to: SchemaSnapshot) => {
  const ops: MigrationOp[] = [];

  for (const name of Object.keys(from.tables)) {
    const table = from.tables[name];

    if (!table) continue;
    if (to.tables[name]) continue;

    ops.push({ kind: "dropTable", table });
  }

  return ops;
};

export const diffSchemas = (
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  adapter: Adapter,
  options?: { strictAddColumn?: boolean },
) => {
  const dialect = getMigrationDialect(adapter);
  const strictAddColumn = options?.strictAddColumn ?? true;
  const ops: MigrationOp[] = [
    ...createdTables(from, to),
    ...droppedTables(from, to),
  ];

  for (const name of Object.keys(to.tables)) {
    const fromTable = from.tables[name];
    const toTable = to.tables[name];

    if (!fromTable) continue;
    if (!toTable) continue;

    const tableOps = diffTable(name, fromTable, toTable, strictAddColumn);

    ops.push(...dialect.foldTableOps(fromTable, toTable, tableOps));
  }

  return ops;
};

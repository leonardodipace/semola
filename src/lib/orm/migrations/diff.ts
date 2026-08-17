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
  return JSON.stringify(a) === JSON.stringify(b);
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
): MigrationOp[] => {
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
): MigrationOp[] => {
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

export const invertOps = (ops: MigrationOp[]): MigrationOp[] => {
  const inverted: MigrationOp[] = [];

  for (let index = ops.length - 1; index >= 0; index--) {
    const op = ops[index];

    if (!op) continue;

    switch (op.kind) {
      case "createTable":
        inverted.push({ kind: "dropTable", table: op.table });
        break;
      case "dropTable":
        inverted.push({ kind: "createTable", table: op.table });
        break;
      case "addColumn":
        inverted.push({
          kind: "dropColumn",
          table: op.table,
          column: op.column,
        });
        break;
      case "dropColumn":
        inverted.push({
          kind: "addColumn",
          table: op.table,
          column: op.column,
        });
        break;
      case "alterColumn":
        inverted.push({
          kind: "alterColumn",
          table: op.table,
          from: op.to,
          to: op.from,
        });
        break;
      case "recreateTable":
        inverted.push({
          kind: "recreateTable",
          from: op.to,
          to: op.from,
        });
        break;
    }
  }

  return inverted;
};

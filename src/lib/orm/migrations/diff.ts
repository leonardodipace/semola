import type { CheckSnapshot } from "../checks/types.js";
import { MigrationError } from "../errors.js";
import type { IndexSnapshot } from "../indexes/types.js";
import type { MigrationDialect } from "./dialect/index.js";
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
  if (a.references?.table !== b.references?.table) return false;
  if (a.references?.column !== b.references?.column) return false;
  if (JSON.stringify(a.enumValues) !== JSON.stringify(b.enumValues)) {
    return false;
  }

  return true;
};

const checksEqual = (a: CheckSnapshot, b: CheckSnapshot) => {
  if (a.name !== b.name) return false;
  if (a.table !== b.table) return false;
  if (a.expression !== b.expression) return false;
  if (a.columns.join("\0") !== b.columns.join("\0")) return false;

  return true;
};

const indexesEqual = (a: IndexSnapshot, b: IndexSnapshot) => {
  if (a.name !== b.name) return false;
  if (a.table !== b.table) return false;
  if (a.unique !== b.unique) return false;
  if (a.where !== b.where) return false;
  if (a.columns.join("\0") !== b.columns.join("\0")) return false;

  return true;
};

const pkNames = (table: TableSnapshot) => {
  return Object.values(table.columns)
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name);
};

const assertAddableColumn = (table: string, column: ColumnSnapshot) => {
  if (column.isNullable) return;
  if (column.dbDefault !== undefined) return;

  throw new MigrationError(
    `Cannot add NOT NULL column ${table}.${column.name} without .dbDefault(...)`,
  );
};

const pkOps = (
  name: string,
  fromTable: TableSnapshot,
  toTable: TableSnapshot,
) => {
  const fromPk = pkNames(fromTable);
  const toPk = pkNames(toTable);
  const ops: MigrationOp[] = [];

  if (fromPk.join("\0") === toPk.join("\0")) return ops;

  if (fromPk.length) {
    ops.push({ kind: "dropPrimaryKey", table: name });
  }

  if (toPk.length) {
    ops.push({ kind: "addPrimaryKey", table: name, columns: toPk });
  }

  return ops;
};

const createdTables = (from: SchemaSnapshot, to: SchemaSnapshot) => {
  const ops: MigrationOp[] = [];

  for (const name of Object.keys(to.tables)) {
    const table = to.tables[name];

    if (!table) continue;
    if (from.tables[name]) continue;

    ops.push({ kind: "createTable", table });

    for (const index of Object.values(table.indexes)) {
      ops.push({ kind: "createIndex", index });
    }
  }

  return ops;
};

const droppedTables = (from: SchemaSnapshot, to: SchemaSnapshot) => {
  const ops: MigrationOp[] = [];

  for (const name of Object.keys(from.tables)) {
    const table = from.tables[name];

    if (!table) continue;
    if (to.tables[name]) continue;

    for (const index of Object.values(table.indexes)) {
      ops.push({ kind: "dropIndex", index });
    }

    ops.push({ kind: "dropTable", table });
  }

  return ops;
};

const dropChecksForColumn = (
  columnName: string,
  fromTable: TableSnapshot,
  droppedChecks: Set<string>,
) => {
  const ops: MigrationOp[] = [];

  for (const check of Object.values(fromTable.checks)) {
    if (!check.columns.includes(columnName)) continue;
    if (droppedChecks.has(check.name)) continue;

    droppedChecks.add(check.name);
    ops.push({ kind: "dropCheck", check });
  }

  return ops;
};

const diffChecks = (
  fromTable: TableSnapshot,
  toTable: TableSnapshot,
  droppedChecks: Set<string>,
) => {
  const ops: MigrationOp[] = [];

  for (const checkName of Object.keys(fromTable.checks)) {
    const fromCheck = fromTable.checks[checkName];

    if (!fromCheck) continue;
    if (droppedChecks.has(checkName)) continue;

    const toCheck = toTable.checks[checkName];

    if (toCheck) {
      if (checksEqual(fromCheck, toCheck)) continue;
    }

    ops.push({ kind: "dropCheck", check: fromCheck });
  }

  for (const checkName of Object.keys(toTable.checks)) {
    const fromCheck = fromTable.checks[checkName];
    const toCheck = toTable.checks[checkName];

    if (!toCheck) continue;

    if (fromCheck) {
      if (checksEqual(fromCheck, toCheck)) continue;
    }

    ops.push({ kind: "createCheck", check: toCheck });
  }

  return ops;
};

const dropIndexesForColumn = (
  columnName: string,
  fromTable: TableSnapshot,
  droppedIndexes: Set<string>,
) => {
  const ops: MigrationOp[] = [];

  for (const index of Object.values(fromTable.indexes)) {
    if (!index.columns.includes(columnName)) continue;
    if (droppedIndexes.has(index.name)) continue;

    droppedIndexes.add(index.name);
    ops.push({ kind: "dropIndex", index });
  }

  return ops;
};

const diffIndexes = (
  fromTable: TableSnapshot,
  toTable: TableSnapshot,
  droppedIndexes: Set<string>,
) => {
  const ops: MigrationOp[] = [];

  for (const indexName of Object.keys(fromTable.indexes)) {
    const fromIndex = fromTable.indexes[indexName];

    if (!fromIndex) continue;
    if (droppedIndexes.has(indexName)) continue;

    const toIndex = toTable.indexes[indexName];

    if (toIndex) {
      if (indexesEqual(fromIndex, toIndex)) continue;
    }

    ops.push({ kind: "dropIndex", index: fromIndex });
  }

  for (const indexName of Object.keys(toTable.indexes)) {
    const fromIndex = fromTable.indexes[indexName];
    const toIndex = toTable.indexes[indexName];

    if (!toIndex) continue;

    if (fromIndex) {
      if (indexesEqual(fromIndex, toIndex)) continue;
    }

    ops.push({ kind: "createIndex", index: toIndex });
  }

  return ops;
};

const diffTable = (
  name: string,
  fromTable: TableSnapshot,
  toTable: TableSnapshot,
  strictAddColumn: boolean,
) => {
  const tableOps: MigrationOp[] = [];
  const droppedIndexes = new Set<string>();
  const droppedChecks = new Set<string>();

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

    if (!columnsEqual(prev, next)) {
      tableOps.push({
        kind: "alterColumn",
        table: name,
        from: prev,
        to: next,
      });
    }
  }

  for (const columnName of Object.keys(fromTable.columns)) {
    if (toTable.columns[columnName]) continue;

    const column = fromTable.columns[columnName];

    if (!column) continue;

    tableOps.push(...dropChecksForColumn(columnName, fromTable, droppedChecks));
    tableOps.push(
      ...dropIndexesForColumn(columnName, fromTable, droppedIndexes),
    );
    tableOps.push({
      kind: "dropColumn",
      table: name,
      column,
    });
  }

  tableOps.push(...pkOps(name, fromTable, toTable));
  tableOps.push(...diffChecks(fromTable, toTable, droppedChecks));
  tableOps.push(...diffIndexes(fromTable, toTable, droppedIndexes));

  return tableOps;
};

export const diffSchemas = (
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  dialect: MigrationDialect,
  options?: { strictAddColumn?: boolean },
) => {
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

    ops.push(...diffTable(name, fromTable, toTable, strictAddColumn));
  }

  return dialect.normalizeOps(from, to, ops);
};

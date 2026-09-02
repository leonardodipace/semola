import { MigrationError } from "../../errors.js";
import type { ColumnSnapshot, MigrationOp, TableSnapshot } from "../types.js";

export const withoutForeignKeys = (table: TableSnapshot) => {
  const columns: Record<string, ColumnSnapshot> = {};

  for (const column of Object.values(table.columns)) {
    const { references: _references, ...rest } = column;

    columns[column.name] = rest;
  }

  return { name: table.name, columns, indexes: table.indexes };
};

export const foreignKeysOf = (tables: TableSnapshot[]) => {
  const ops: MigrationOp[] = [];

  for (const table of tables) {
    for (const column of Object.values(table.columns)) {
      if (!column.references) continue;

      ops.push({ kind: "addForeignKey", table: table.name, column });
    }
  }

  return ops;
};

const foreignKeysBetween = (tables: TableSnapshot[]) => {
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
};

const sortTables = (tables: TableSnapshot[]) => {
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
};

export const orderOps = (
  ops: MigrationOp[],
  deferCircularForeignKeys: boolean,
) => {
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
  const createIndexes: MigrationOp[] = [];
  const dropIndexes: MigrationOp[] = [];
  const renames: MigrationOp[] = [];

  for (const op of ops) {
    switch (op.kind) {
      case "renameTable":
      case "renameColumn":
        renames.push(op);
        break;
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
      case "createIndex":
        createIndexes.push(op);
        break;
      case "dropIndex":
        dropIndexes.push(op);
        break;
    }
  }

  const sortedCreates = sortTables(creates);
  const sortedDrops = sortTables(drops);

  if (sortedCreates.cycle && !deferCircularForeignKeys) {
    throw new MigrationError(
      "Circular foreign keys between new tables are not supported on this adapter; create one side without a reference first, then add the foreign key in a later migration",
    );
  }

  const stripCreateFks = deferCircularForeignKeys && sortedCreates.cycle;
  const createOps = sortedCreates.ordered.map((table) => {
    let nextTable = table;

    if (stripCreateFks) {
      nextTable = withoutForeignKeys(table);
    }

    return {
      kind: "createTable" as const,
      table: nextTable,
    };
  });
  const dropOps = [...sortedDrops.ordered].reverse().map((table) => {
    return { kind: "dropTable" as const, table };
  });

  let cycleForeignKeys: MigrationOp[] = [];

  if (stripCreateFks) {
    cycleForeignKeys = foreignKeysOf(sortedCreates.ordered);
  }

  let cycleDropForeignKeys: MigrationOp[] = [];

  if (deferCircularForeignKeys) {
    if (sortedDrops.cycle) {
      cycleDropForeignKeys = foreignKeysBetween(sortedDrops.ordered);
    }
  }

  return [
    ...renames,
    ...cycleDropForeignKeys,
    ...dropForeignKeys,
    ...dropIndexes,
    ...dropPrimaryKeys,
    ...dropColumns,
    ...createOps,
    ...createIndexes,
    ...alterColumns,
    ...recreates,
    ...dropOps,
    ...addColumns,
    ...addPrimaryKeys,
    ...addForeignKeys,
    ...cycleForeignKeys,
  ];
};

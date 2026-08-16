import type { Adapter } from "../dialect/types.js";
import type { ColumnSnapshot, MigrationOp, SchemaSnapshot } from "./types.js";

const columnsEqual = (a: ColumnSnapshot, b: ColumnSnapshot) => {
  return JSON.stringify(a) === JSON.stringify(b);
};

const sqliteNeedsRecreate = (from: ColumnSnapshot, to: ColumnSnapshot) => {
  if (from.type !== to.type) return true;
  if (from.sqlType !== to.sqlType) return true;
  if (from.isNullable !== to.isNullable) return true;
  if (from.isPrimaryKey !== to.isPrimaryKey) return true;
  if (from.isUnique !== to.isUnique) return true;
  if (from.dbDefault !== to.dbDefault) return true;
  if (JSON.stringify(from.enumValues) !== JSON.stringify(to.enumValues)) {
    return true;
  }
  if (JSON.stringify(from.references) !== JSON.stringify(to.references)) {
    return true;
  }

  return false;
};

export const diffSchemas = (
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  adapter: Adapter,
): MigrationOp[] => {
  const ops: MigrationOp[] = [];
  const fromNames = Object.keys(from.tables);
  const toNames = Object.keys(to.tables);

  for (const name of toNames) {
    const table = to.tables[name];

    if (!table) continue;
    if (from.tables[name]) continue;

    ops.push({ kind: "createTable", table });
  }

  for (const name of fromNames) {
    const table = from.tables[name];

    if (!table) continue;
    if (to.tables[name]) continue;

    ops.push({ kind: "dropTable", table });
  }

  for (const name of toNames) {
    const fromTable = from.tables[name];
    const toTable = to.tables[name];

    if (!fromTable) continue;
    if (!toTable) continue;

    const tableOps: MigrationOp[] = [];

    for (const columnName of Object.keys(toTable.columns)) {
      const next = toTable.columns[columnName];
      const prev = fromTable.columns[columnName];

      if (!next) continue;

      if (!prev) {
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

    if (adapter === "sqlite") {
      const needsRecreate = tableOps.some((op) => {
        if (op.kind !== "alterColumn") return false;

        return sqliteNeedsRecreate(op.from, op.to);
      });

      if (needsRecreate) {
        ops.push({
          kind: "recreateTable",
          from: fromTable,
          to: toTable,
        });
        continue;
      }
    }

    ops.push(...tableOps);
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

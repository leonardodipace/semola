import type { ColumnSnapshot, MigrationOp } from "../types.js";

const renameWarning = (table: string, dropped: string[], added: string[]) => {
  if (!dropped.length) return;
  if (!added.length) return;

  return `-- warning: "${table}" drops ${dropped.join(", ")} and adds ${added.join(", ")}`;
};

export const isConstantDefault = (value?: string) => {
  if (value === undefined) return false;
  if (value === "TRUE") return true;
  if (value === "FALSE") return true;
  if (value === "NULL") return true;
  if (value.startsWith("'") && value.endsWith("'")) return true;

  return /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
};

const pushAddColumnWarnings = (
  warnings: string[],
  table: string,
  column: ColumnSnapshot,
) => {
  if (!column.isNullable) {
    if (column.dbDefault === undefined) {
      warnings.push(
        `-- warning: ADD COLUMN "${table}"."${column.name}" NOT NULL without default fails if the table has rows`,
      );
    }
  }

  const isUniqueOrPrimary = column.isUnique || column.isPrimaryKey;

  if (!isUniqueOrPrimary) return;
  if (!isConstantDefault(column.dbDefault)) return;

  warnings.push(
    `-- warning: ADD COLUMN "${table}"."${column.name}" unique/primary key with a constant default fails if the table has more than one row`,
  );
};

const notNullWarning = (label: string) => {
  return `-- warning: ${label} fails if existing rows contain NULL`;
};

const enumCheckMayFail = (from: ColumnSnapshot, to: ColumnSnapshot) => {
  if (!to.enumValues?.length) return false;

  if (!from.enumValues?.length) return true;

  const allowed = new Set(to.enumValues);

  for (const value of from.enumValues) {
    if (!allowed.has(value)) return true;
  }

  return false;
};

const enumCheckWarning = (label: string, column: ColumnSnapshot) => {
  return `-- warning: ${label} enum CHECK fails if existing rows have values outside ${column.enumValues?.join(", ")}`;
};

export const hasDestructiveOps = (ops: MigrationOp[]) => {
  for (const op of ops) {
    if (op.kind === "dropTable") return true;
    if (op.kind === "dropColumn") return true;

    if (op.kind === "recreateTable") {
      for (const name of Object.keys(op.from.columns)) {
        if (!op.to.columns[name]) return true;
      }
    }
  }

  return false;
};

export const dataLossWarnings = (ops: MigrationOp[]) => {
  const warnings: string[] = [];
  const dropped = new Map<string, string[]>();
  const added = new Map<string, string[]>();
  const droppedTables: string[] = [];
  const createdTables: string[] = [];

  const record = (
    map: Map<string, string[]>,
    table: string,
    column: string,
  ) => {
    const columns = map.get(table);

    if (columns) {
      columns.push(column);
      return;
    }

    map.set(table, [column]);
  };

  for (const op of ops) {
    if (op.kind === "dropTable") {
      droppedTables.push(op.table.name);
      continue;
    }

    if (op.kind === "createTable") {
      createdTables.push(op.table.name);
      continue;
    }

    if (op.kind === "dropColumn") {
      record(dropped, op.table, op.column.name);
      continue;
    }

    if (op.kind === "addColumn") {
      record(added, op.table, op.column.name);
      pushAddColumnWarnings(warnings, op.table, op.column);
      continue;
    }

    if (op.kind === "alterColumn") {
      if (op.from.isNullable) {
        if (!op.to.isNullable) {
          warnings.push(
            notNullWarning(
              `ALTER COLUMN "${op.table}"."${op.to.name}" SET NOT NULL`,
            ),
          );
        }
      }

      if (enumCheckMayFail(op.from, op.to)) {
        warnings.push(
          enumCheckWarning(`ALTER COLUMN "${op.table}"."${op.to.name}"`, op.to),
        );
      }

      continue;
    }

    if (op.kind !== "recreateTable") continue;

    const warning = renameWarning(
      op.to.name,
      Object.keys(op.from.columns).filter((name) => !op.to.columns[name]),
      Object.keys(op.to.columns).filter((name) => !op.from.columns[name]),
    );

    if (warning) warnings.push(warning);

    for (const column of Object.values(op.to.columns)) {
      const previous = op.from.columns[column.name];

      if (!previous) {
        pushAddColumnWarnings(warnings, op.to.name, column);
        continue;
      }

      if (previous.isNullable) {
        if (!column.isNullable) {
          warnings.push(
            notNullWarning(
              `recreate "${op.to.name}"."${column.name}" as NOT NULL`,
            ),
          );
        }
      }

      if (enumCheckMayFail(previous, column)) {
        warnings.push(
          enumCheckWarning(`recreate "${op.to.name}"."${column.name}"`, column),
        );
      }
    }
  }

  if (droppedTables.length) {
    if (createdTables.length) {
      warnings.push(
        `-- warning: drops table(s) ${droppedTables.join(", ")} and creates ${createdTables.join(", ")}; data in dropped tables will be lost`,
      );
    } else {
      warnings.push(
        `-- warning: drops table(s) ${droppedTables.join(", ")}; data in those tables will be lost`,
      );
    }
  }

  for (const [table, droppedCols] of dropped) {
    const warning = renameWarning(table, droppedCols, added.get(table) ?? []);

    if (warning) warnings.push(warning);
  }

  return warnings;
};

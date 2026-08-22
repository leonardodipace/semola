import { MigrationError } from "../errors.js";
import type {
  MigrationOp,
  RenameHandler,
  RenameQuestion,
  SchemaSnapshot,
} from "./types.js";

const pickRename = async (
  question: RenameQuestion,
  onRename: RenameHandler | undefined,
) => {
  if (!onRename) {
    const dropped = question.dropped.join(", ");

    if (question.kind === "table") {
      throw new MigrationError(
        `Possible table rename: dropped ${dropped}, created ${question.created}. Pass onRename or run bunx semola orm migrations create`,
      );
    }

    throw new MigrationError(
      `Possible column rename on ${question.table}: dropped ${dropped}, created ${question.created}. Pass onRename or run bunx semola orm migrations create`,
    );
  }

  const chosen = await onRename(question);

  if (chosen === undefined) {
    return;
  }

  if (!question.dropped.includes(chosen)) {
    throw new MigrationError(`Unknown rename source "${chosen}"`);
  }

  return chosen;
};

const rewriteTableName = (schema: SchemaSnapshot, from: string, to: string) => {
  const table = schema.tables[from];

  if (!table) {
    throw new MigrationError(`Cannot rename missing table ${from}`);
  }

  delete schema.tables[from];
  table.name = to;
  schema.tables[to] = table;

  for (const current of Object.values(schema.tables)) {
    for (const column of Object.values(current.columns)) {
      if (!column.references) continue;
      if (column.references.table !== from) continue;

      column.references.table = to;
    }
  }
};

const rewriteColumnName = (
  schema: SchemaSnapshot,
  tableName: string,
  from: string,
  to: string,
) => {
  const table = schema.tables[tableName];

  if (!table) {
    throw new MigrationError(
      `Cannot rename column on missing table ${tableName}`,
    );
  }

  const column = table.columns[from];

  if (!column) {
    throw new MigrationError(
      `Cannot rename missing column ${tableName}.${from}`,
    );
  }

  delete table.columns[from];
  column.name = to;
  table.columns[to] = column;

  for (const current of Object.values(schema.tables)) {
    for (const col of Object.values(current.columns)) {
      if (!col.references) continue;
      if (col.references.table !== tableName) continue;
      if (col.references.column !== from) continue;

      col.references.column = to;
    }
  }
};

export const resolveRenames = async (
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  onRename?: RenameHandler,
) => {
  const schema = structuredClone(from);
  const ops: MigrationOp[] = [];
  const droppedTables = Object.keys(schema.tables).filter((name) => {
    return !to.tables[name];
  });
  const createdTables = Object.keys(to.tables).filter((name) => {
    return !schema.tables[name];
  });
  const remainingTables = [...droppedTables];

  for (const created of createdTables) {
    if (remainingTables.length === 0) break;

    const chosen = await pickRename(
      { kind: "table", created, dropped: remainingTables },
      onRename,
    );

    if (!chosen) continue;

    remainingTables.splice(remainingTables.indexOf(chosen), 1);
    rewriteTableName(schema, chosen, created);
    ops.push({ kind: "renameTable", from: chosen, to: created });
  }

  for (const tableName of Object.keys(to.tables)) {
    const fromTable = schema.tables[tableName];
    const toTable = to.tables[tableName];

    if (!fromTable) continue;
    if (!toTable) continue;

    const droppedCols = Object.keys(fromTable.columns).filter((name) => {
      return !toTable.columns[name];
    });
    const createdCols = Object.keys(toTable.columns).filter((name) => {
      return !fromTable.columns[name];
    });
    const remainingCols = [...droppedCols];

    for (const created of createdCols) {
      if (remainingCols.length === 0) break;

      const chosen = await pickRename(
        {
          kind: "column",
          table: tableName,
          created,
          dropped: remainingCols,
        },
        onRename,
      );

      if (!chosen) continue;

      remainingCols.splice(remainingCols.indexOf(chosen), 1);
      rewriteColumnName(schema, tableName, chosen, created);
      ops.push({
        kind: "renameColumn",
        table: tableName,
        from: chosen,
        to: created,
      });
    }
  }

  return { from: schema, ops };
};

export const reverseRenameOps = (ops: MigrationOp[]) => {
  return [...ops].reverse().map((op) => {
    if (op.kind === "renameTable") {
      return { kind: "renameTable" as const, from: op.to, to: op.from };
    }

    if (op.kind === "renameColumn") {
      return {
        kind: "renameColumn" as const,
        table: op.table,
        from: op.to,
        to: op.from,
      };
    }

    return op;
  });
};

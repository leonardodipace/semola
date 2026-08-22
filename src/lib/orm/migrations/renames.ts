import { MigrationError } from "../errors.js";
import type {
  MigrationOp,
  RenameHandler,
  RenameQuestion,
  SchemaSnapshot,
} from "./types.js";

const ask = async (question: RenameQuestion, onRename?: RenameHandler) => {
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

  if (chosen === undefined) return;

  if (!question.dropped.includes(chosen)) {
    throw new MigrationError(`Unknown rename source "${chosen}"`);
  }

  return chosen;
};

const patchRefs = (
  schema: SchemaSnapshot,
  patch: (ref: { table: string; column: string }) => void,
) => {
  for (const table of Object.values(schema.tables)) {
    for (const column of Object.values(table.columns)) {
      if (!column.references) continue;

      patch(column.references);
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
  const remainingTables = Object.keys(schema.tables).filter((name) => {
    return !to.tables[name];
  });

  for (const created of Object.keys(to.tables)) {
    if (schema.tables[created]) continue;
    if (remainingTables.length === 0) break;

    const chosen = await ask(
      { kind: "table", created, dropped: remainingTables },
      onRename,
    );

    if (!chosen) continue;

    remainingTables.splice(remainingTables.indexOf(chosen), 1);

    const table = schema.tables[chosen];

    if (!table) continue;

    delete schema.tables[chosen];
    table.name = created;
    schema.tables[created] = table;

    patchRefs(schema, (ref) => {
      if (ref.table === chosen) ref.table = created;
    });

    ops.push({ kind: "renameTable", from: chosen, to: created });
  }

  for (const tableName of Object.keys(to.tables)) {
    const fromTable = schema.tables[tableName];
    const toTable = to.tables[tableName];

    if (!fromTable) continue;
    if (!toTable) continue;

    const remainingCols = Object.keys(fromTable.columns).filter((name) => {
      return !toTable.columns[name];
    });

    for (const created of Object.keys(toTable.columns)) {
      if (fromTable.columns[created]) continue;
      if (remainingCols.length === 0) break;

      const chosen = await ask(
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

      const column = fromTable.columns[chosen];

      if (!column) continue;

      delete fromTable.columns[chosen];
      column.name = created;
      fromTable.columns[created] = column;

      patchRefs(schema, (ref) => {
        if (ref.table !== tableName) return;
        if (ref.column !== chosen) return;

        ref.column = created;
      });

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

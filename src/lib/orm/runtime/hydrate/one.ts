import {
  findColumnBySqlName,
  getPrimaryKeyColumn,
} from "../../internal/table.js";
import type { Table } from "../../table.js";
import type { ColDefs, TableRow } from "../../types.js";
import type { SelectWhereIn } from "./types.js";

export async function hydrateOneRelation<T extends ColDefs>(options: {
  rows: TableRow<T>[];
  relationKey: string;
  relationForeignKey: string;
  table: Table<T>;
  targetTable: Table<ColDefs>;
  selectWhereIn: SelectWhereIn;
}) {
  const {
    rows,
    relationKey,
    relationForeignKey,
    table,
    targetTable,
    selectWhereIn,
  } = options;

  const targetPk = getPrimaryKeyColumn(targetTable);

  if (!targetPk) {
    for (const row of rows) {
      Reflect.set(row as Record<string, unknown>, relationKey, null);
    }

    return;
  }

  const sourceFk = findColumnBySqlName(table, relationForeignKey);

  if (!sourceFk) {
    for (const row of rows) {
      Reflect.set(row as Record<string, unknown>, relationKey, null);
    }

    return;
  }

  const fkValues = new Set<unknown>();

  for (const row of rows) {
    const value = Reflect.get(row as Record<string, unknown>, sourceFk.jsKey);

    if (value === null || value === undefined) {
      continue;
    }

    fkValues.add(value);
  }

  const targetRows = await selectWhereIn(
    targetTable,
    targetPk.col.meta.sqlName,
    Array.from(fkValues),
  );

  const byPk = new Map<unknown, Record<string, unknown>>();

  for (const targetRow of targetRows) {
    const key = Reflect.get(targetRow, targetPk.jsKey);

    if (key === null || key === undefined) {
      continue;
    }

    byPk.set(key, targetRow);
  }

  for (const row of rows) {
    const sourceKey = Reflect.get(
      row as Record<string, unknown>,
      sourceFk.jsKey,
    );

    if (sourceKey === null || sourceKey === undefined) {
      Reflect.set(row as Record<string, unknown>, relationKey, null);
      continue;
    }

    Reflect.set(
      row as Record<string, unknown>,
      relationKey,
      byPk.get(sourceKey) ?? null,
    );
  }
}

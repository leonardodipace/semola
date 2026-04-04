import type { getPrimaryKeyColumn } from "../../internal/table.js";
import {
  findColumnBySqlName,
  findManyForeignKeyByReference,
  inferManyForeignKeyFromInverse,
} from "../../internal/table.js";
import type { Table } from "../../table.js";
import type { ColDefs, RelationDefs, TableRow } from "../../types.js";
import type { SelectWhereIn } from "./types.js";

export async function hydrateManyRelation<T extends ColDefs>(options: {
  rows: TableRow<T>[];
  relationKey: string;
  relationForeignKey: string | undefined;
  table: Table<T>;
  targetTable: Table<ColDefs>;
  basePk: NonNullable<ReturnType<typeof getPrimaryKeyColumn>>;
  allRelations: Partial<Record<string, RelationDefs>>;
  allTables: Record<string, Table<ColDefs>>;
  selectWhereIn: SelectWhereIn;
}) {
  const {
    rows,
    relationKey,
    relationForeignKey,
    table,
    targetTable,
    basePk,
    allRelations,
    allTables,
    selectWhereIn,
  } = options;

  let foreignKeySqlName: string | null | undefined = relationForeignKey;

  if (!foreignKeySqlName) {
    foreignKeySqlName = findManyForeignKeyByReference(targetTable, basePk.col);
  }

  if (!foreignKeySqlName) {
    foreignKeySqlName = inferManyForeignKeyFromInverse(
      table,
      targetTable,
      allRelations,
      allTables,
    );
  }

  if (!foreignKeySqlName) {
    for (const row of rows) {
      Reflect.set(row as Record<string, unknown>, relationKey, []);
    }

    return;
  }

  const targetFk = findColumnBySqlName(targetTable, foreignKeySqlName);

  if (!targetFk) {
    for (const row of rows) {
      Reflect.set(row as Record<string, unknown>, relationKey, []);
    }

    return;
  }

  const baseIds: unknown[] = [];

  for (const row of rows) {
    const id = Reflect.get(row as Record<string, unknown>, basePk.jsKey);

    if (id === null || id === undefined) {
      continue;
    }

    baseIds.push(id);
  }

  const targetRows = await selectWhereIn(
    targetTable,
    targetFk.col.meta.sqlName,
    baseIds,
  );

  const grouped = new Map<unknown, Record<string, unknown>[]>();

  for (const targetRow of targetRows) {
    const sourceId = Reflect.get(targetRow, targetFk.jsKey);

    if (sourceId === null || sourceId === undefined) {
      continue;
    }

    const existing = grouped.get(sourceId);

    if (!existing) {
      grouped.set(sourceId, [targetRow]);
      continue;
    }

    existing.push(targetRow);
  }

  for (const row of rows) {
    const id = Reflect.get(row as Record<string, unknown>, basePk.jsKey);

    if (id === null || id === undefined) {
      Reflect.set(row as Record<string, unknown>, relationKey, []);
      continue;
    }

    Reflect.set(
      row as Record<string, unknown>,
      relationKey,
      grouped.get(id) ?? [],
    );
  }
}

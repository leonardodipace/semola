import { err, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { OrmDialect } from "../core/types.js";
import type { Table } from "../table/index.js";

export type ColumnSnapshot = {
  name: string;
  type: ColumnKind;
  primaryKey: boolean;
  notNull: boolean;
  unique: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
};

export type TableSnapshot = {
  name: string;
  columns: Record<string, ColumnSnapshot>;
};

export type SchemaSnapshot = {
  version: number;
  dialect: OrmDialect;
  tables: Record<string, TableSnapshot>;
};

const serializeColumn = (
  column: Column<ColumnKind, ColumnMeta>,
): ColumnSnapshot => {
  return {
    name: column.sqlName,
    type: column.columnKind,
    primaryKey: column.meta.primaryKey,
    notNull: column.meta.notNull,
    unique: column.meta.unique,
    hasDefault: column.meta.hasDefault,
    defaultValue: column.defaultValue,
  };
};

const serializeTable = (table: Table): TableSnapshot => {
  const columns: Record<string, ColumnSnapshot> = {};

  for (const [key, column] of Object.entries(table.columns)) {
    columns[key] = serializeColumn(column);
  }

  return {
    name: table.sqlName,
    columns,
  };
};

export const createSnapshot = (
  tables: Record<string, Table>,
  dialect: OrmDialect,
): SchemaSnapshot => {
  const tablesSnapshot: Record<string, TableSnapshot> = {};

  for (const [key, table] of Object.entries(tables)) {
    tablesSnapshot[key] = serializeTable(table);
  }

  return {
    version: 1,
    dialect,
    tables: tablesSnapshot,
  };
};

export const writeSnapshot = async (
  filePath: string,
  snapshot: SchemaSnapshot,
) => {
  try {
    const json = JSON.stringify(snapshot, null, 2);
    await Bun.write(filePath, json);
    return [null, snapshot] as const;
  } catch (error) {
    return [error, null] as const;
  }
};

export const readSnapshot = async (filePath: string) => {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return ok(null);
  }

  try {
    const content = await file.text();
    const snapshot = JSON.parse(content);

    // Basic validation
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      typeof snapshot.version !== "number" ||
      typeof snapshot.dialect !== "string" ||
      typeof snapshot.tables !== "object"
    ) {
      return err("ValidationError", `Invalid snapshot format in ${filePath}`);
    }

    return ok(snapshot);
  } catch (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }
};

import { err, mightThrow, mightThrowSync, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type {
  ColumnKind,
  ColumnMeta,
  OnDeleteAction,
} from "../column/types.js";
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
  references?: { tableName: string; columnName: string };
  onDelete?: OnDeleteAction;
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

const serializeColumn = (column: Column<ColumnKind, ColumnMeta>) => {
  const snapshot: ColumnSnapshot = {
    name: column.sqlName,
    type: column.columnKind,
    primaryKey: column.meta.primaryKey,
    notNull: column.meta.notNull,
    unique: column.meta.unique,
    hasDefault: column.meta.hasDefault,
    defaultValue: column.defaultValue,
  };

  if (column.foreignKeyRef) {
    snapshot.references = column.foreignKeyRef;
  }

  if (column.onDeleteAction) {
    snapshot.onDelete = column.onDeleteAction;
  }

  return snapshot;
};

const serializeTable = (table: Table) => {
  const columns: Record<string, ColumnSnapshot> = {};

  for (const [key, column] of Object.entries(table.columns)) {
    columns[key] = serializeColumn(column);
  }

  const snapshot: TableSnapshot = {
    name: table.sqlName,
    columns,
  };

  return snapshot;
};

export const createSnapshot = (
  tables: Record<string, Table>,
  dialect: OrmDialect,
) => {
  const tablesSnapshot: Record<string, TableSnapshot> = {};

  for (const [key, table] of Object.entries(tables)) {
    tablesSnapshot[key] = serializeTable(table);
  }

  const snapshot: SchemaSnapshot = {
    version: 1,
    dialect,
    tables: tablesSnapshot,
  };

  return snapshot;
};

export const writeSnapshot = async (
  filePath: string,
  snapshot: SchemaSnapshot,
) => {
  const [error] = await mightThrow(
    Bun.write(filePath, JSON.stringify(snapshot, null, 2)),
  );
  if (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }
  return ok(snapshot);
};

export const readSnapshot = async (filePath: string) => {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return ok(null);
  }

  const [readError, content] = await mightThrow(file.text());
  if (readError) {
    return err(
      "InternalServerError",
      readError instanceof Error ? readError.message : String(readError),
    );
  }

  const [parseError, snapshot] = mightThrowSync(() =>
    JSON.parse(content ?? ""),
  );
  if (parseError) {
    return err(
      "InternalServerError",
      parseError instanceof Error ? parseError.message : String(parseError),
    );
  }

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
};

import { MigrationError } from "../errors.js";
import type { IndexSnapshot } from "../indexes/types.js";
import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from "./types.js";

const DOLLAR_TAG = /^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/;

const COLUMN_TYPES = new Set([
  "string",
  "enum",
  "number",
  "boolean",
  "date",
  "json",
  "jsonb",
]);

const isPlainObject = (value: unknown) => {
  if (typeof value !== "object") return false;
  if (value === null) return false;
  if (Array.isArray(value)) return false;

  return true;
};

const asRecord = (value: unknown) => {
  return value as Record<string, unknown>;
};

const nonEmptyString = (value: unknown, label: string, detail: string) => {
  if (typeof value !== "string") {
    throw new MigrationError(`Invalid ${label}: ${detail}`);
  }

  if (!value) {
    throw new MigrationError(`Invalid ${label}: ${detail}`);
  }

  return value;
};

const requireBoolean = (value: unknown, label: string, detail: string) => {
  if (typeof value === "boolean") return;

  throw new MigrationError(`Invalid ${label}: ${detail}`);
};

const assertColumnSnapshot = (
  value: unknown,
  label: string,
  tableName: string,
  columnKey: string,
) => {
  if (!isPlainObject(value)) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} must be an object`,
    );
  }

  const column = asRecord(value);
  const col = `table ${tableName} column ${columnKey}`;
  const name = nonEmptyString(column.name, label, `${col} missing name`);

  if (name !== columnKey) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column key ${columnKey} does not match name ${name}`,
    );
  }

  const type = column.type;

  if (typeof type !== "string") {
    throw new MigrationError(`Invalid ${label}: ${col} has unknown type`);
  }

  if (!COLUMN_TYPES.has(type)) {
    throw new MigrationError(`Invalid ${label}: ${col} has unknown type`);
  }

  requireBoolean(column.isNullable, label, `${col} missing isNullable`);
  requireBoolean(column.isPrimaryKey, label, `${col} missing isPrimaryKey`);
  requireBoolean(column.isUnique, label, `${col} missing isUnique`);

  if (column.sqlType !== undefined) {
    if (column.sqlType !== "uuid") {
      throw new MigrationError(`Invalid ${label}: ${col} has unknown sqlType`);
    }
  }

  if (column.dbDefault !== undefined) {
    if (typeof column.dbDefault !== "string") {
      throw new MigrationError(
        `Invalid ${label}: ${col} has invalid dbDefault`,
      );
    }
  }

  const enumValues = column.enumValues;

  if (enumValues !== undefined) {
    if (!Array.isArray(enumValues)) {
      throw new MigrationError(
        `Invalid ${label}: ${col} has invalid enumValues`,
      );
    }

    if (enumValues.some((entry) => typeof entry !== "string")) {
      throw new MigrationError(
        `Invalid ${label}: ${col} has invalid enumValues`,
      );
    }
  }

  if (column.references !== undefined) {
    if (!isPlainObject(column.references)) {
      throw new MigrationError(
        `Invalid ${label}: ${col} has invalid references`,
      );
    }

    const references = asRecord(column.references);

    nonEmptyString(references.table, label, `${col} has invalid references`);
    nonEmptyString(references.column, label, `${col} has invalid references`);
  }

  return value as ColumnSnapshot;
};

const assertIndexSnapshot = (
  value: unknown,
  label: string,
  tableName: string,
  indexKey: string,
) => {
  if (!isPlainObject(value)) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} index ${indexKey} must be an object`,
    );
  }

  const index = asRecord(value);
  const detail = `table ${tableName} index ${indexKey}`;
  const name = nonEmptyString(index.name, label, `${detail} missing name`);

  if (name !== indexKey) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} index key ${indexKey} does not match name ${name}`,
    );
  }

  const table = nonEmptyString(index.table, label, `${detail} missing table`);

  if (table !== tableName) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} index ${indexKey} references table ${table}`,
    );
  }

  requireBoolean(index.unique, label, `${detail} missing unique`);
  const unique = index.unique as boolean;

  const columns = index.columns;

  if (!Array.isArray(columns)) {
    throw new MigrationError(`Invalid ${label}: ${detail} missing columns`);
  }

  if (columns.length === 0) {
    throw new MigrationError(`Invalid ${label}: ${detail} requires columns`);
  }

  if (columns.some((entry) => typeof entry !== "string")) {
    throw new MigrationError(`Invalid ${label}: ${detail} has invalid columns`);
  }

  if (index.where !== undefined) {
    if (typeof index.where !== "string") {
      throw new MigrationError(`Invalid ${label}: ${detail} has invalid where`);
    }

    if (!index.where) {
      throw new MigrationError(`Invalid ${label}: ${detail} has invalid where`);
    }
  }

  const snapshot: IndexSnapshot = {
    name,
    table,
    columns: [...columns],
    unique,
  };

  if (index.where !== undefined) {
    snapshot.where = index.where;
  }

  return snapshot;
};

const assertTableSnapshot = (
  value: unknown,
  label: string,
  tableKey: string,
) => {
  if (!isPlainObject(value)) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableKey} must be an object`,
    );
  }

  const table = asRecord(value);
  const name = nonEmptyString(
    table.name,
    label,
    `table ${tableKey} missing name`,
  );

  if (name !== tableKey) {
    throw new MigrationError(
      `Invalid ${label}: table key ${tableKey} does not match name ${name}`,
    );
  }

  if (!isPlainObject(table.columns)) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableKey} missing columns`,
    );
  }

  const columns: Record<string, ColumnSnapshot> = {};

  for (const [columnKey, column] of Object.entries(asRecord(table.columns))) {
    columns[columnKey] = assertColumnSnapshot(
      column,
      label,
      tableKey,
      columnKey,
    );
  }

  const indexes: Record<string, IndexSnapshot> = {};
  const rawIndexes = table.indexes;

  if (rawIndexes !== undefined) {
    if (!isPlainObject(rawIndexes)) {
      throw new MigrationError(
        `Invalid ${label}: table ${tableKey} has invalid indexes`,
      );
    }

    for (const [indexKey, index] of Object.entries(asRecord(rawIndexes))) {
      indexes[indexKey] = assertIndexSnapshot(index, label, tableKey, indexKey);
    }
  }

  return {
    name,
    columns,
    indexes,
  } satisfies TableSnapshot;
};

export const assertSchemaSnapshot = (value: unknown, label: string) => {
  if (!isPlainObject(value)) {
    throw new MigrationError(`Invalid ${label}: expected a schema object`);
  }

  const record = asRecord(value);

  if (!isPlainObject(record.tables)) {
    throw new MigrationError(`Invalid ${label}: missing tables`);
  }

  const tables: Record<string, TableSnapshot> = {};

  for (const [tableKey, table] of Object.entries(asRecord(record.tables))) {
    tables[tableKey] = assertTableSnapshot(table, label, tableKey);
  }

  for (const table of Object.values(tables)) {
    for (const column of Object.values(table.columns)) {
      if (!column.references) continue;

      const target = tables[column.references.table];

      if (!target) {
        throw new MigrationError(
          `Invalid ${label}: ${table.name}.${column.name} references missing table ${column.references.table}`,
        );
      }

      if (!target.columns[column.references.column]) {
        throw new MigrationError(
          `Invalid ${label}: ${table.name}.${column.name} references missing column ${column.references.table}.${column.references.column}`,
        );
      }
    }

    for (const index of Object.values(table.indexes)) {
      for (const columnName of index.columns) {
        if (!table.columns[columnName]) {
          throw new MigrationError(
            `Invalid ${label}: ${table.name} index ${index.name} references missing column ${columnName}`,
          );
        }
      }
    }
  }

  return { tables } satisfies SchemaSnapshot;
};

const skipQuoted = (source: string, start: number, quote: string) => {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] !== quote) continue;
    if (source[index + 1] === quote) {
      index += 1;
      continue;
    }

    return index;
  }

  return source.length - 1;
};

const isSqlStatement = (text: string) => {
  return text.split("\n").some((line) => {
    const trimmed = line.trim();

    if (!trimmed) return false;
    if (trimmed.startsWith("--")) return false;

    return true;
  });
};

export const splitStatements = (sqlText: string) => {
  const statements: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    current = "";

    if (!trimmed) return;
    if (!isSqlStatement(trimmed)) return;

    statements.push(trimmed);
  };

  for (let index = 0; index < sqlText.length; index++) {
    const char = sqlText[index] ?? "";
    const next = sqlText[index + 1] ?? "";

    if (char === "'" || char === '"') {
      const end = skipQuoted(sqlText, index, char);
      current += sqlText.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === "-" && next === "-") {
      const newline = sqlText.indexOf("\n", index);

      if (newline === -1) {
        index = sqlText.length - 1;
      } else {
        index = newline - 1;
      }

      continue;
    }

    if (char === "/" && next === "*") {
      const close = sqlText.indexOf("*/", index + 2);
      let end = close + 1;

      if (close === -1) {
        end = sqlText.length - 1;
      }

      current += sqlText.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === "$") {
      const tag = sqlText.slice(index).match(DOLLAR_TAG)?.[1];

      if (tag) {
        const close = sqlText.indexOf(tag, index + tag.length);
        let end = close + tag.length - 1;

        if (close === -1) {
          end = sqlText.length - 1;
        }

        current += sqlText.slice(index, end + 1);
        index = end;
        continue;
      }
    }

    if (char === ";") {
      flush();
      continue;
    }

    current += char;
  }

  flush();

  return statements;
};

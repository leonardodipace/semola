import type { Adapter } from "../dialect/types.js";
import { MigrationError } from "../errors.js";
import { getMigrationDialect } from "./dialect/index.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

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

  if (typeof column.name !== "string") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} missing name`,
    );
  }

  if (!column.name) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} missing name`,
    );
  }

  if (column.name !== columnKey) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column key ${columnKey} does not match name ${column.name}`,
    );
  }

  if (typeof column.type !== "string") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} has unknown type`,
    );
  }

  if (!COLUMN_TYPES.has(column.type)) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} has unknown type`,
    );
  }

  if (typeof column.isNullable !== "boolean") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} missing isNullable`,
    );
  }

  if (typeof column.isPrimaryKey !== "boolean") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} missing isPrimaryKey`,
    );
  }

  if (typeof column.isUnique !== "boolean") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} missing isUnique`,
    );
  }

  if (column.sqlType !== undefined && column.sqlType !== "uuid") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} has unknown sqlType`,
    );
  }

  if (column.dbDefault !== undefined && typeof column.dbDefault !== "string") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableName} column ${columnKey} has invalid dbDefault`,
    );
  }

  if (column.enumValues !== undefined) {
    if (!Array.isArray(column.enumValues)) {
      throw new MigrationError(
        `Invalid ${label}: table ${tableName} column ${columnKey} has invalid enumValues`,
      );
    }

    if (column.enumValues.some((entry) => typeof entry !== "string")) {
      throw new MigrationError(
        `Invalid ${label}: table ${tableName} column ${columnKey} has invalid enumValues`,
      );
    }
  }

  if (column.references !== undefined) {
    if (!isPlainObject(column.references)) {
      throw new MigrationError(
        `Invalid ${label}: table ${tableName} column ${columnKey} has invalid references`,
      );
    }

    const references = asRecord(column.references);

    if (typeof references.table !== "string") {
      throw new MigrationError(
        `Invalid ${label}: table ${tableName} column ${columnKey} has invalid references`,
      );
    }

    if (!references.table) {
      throw new MigrationError(
        `Invalid ${label}: table ${tableName} column ${columnKey} has invalid references`,
      );
    }

    if (typeof references.column !== "string") {
      throw new MigrationError(
        `Invalid ${label}: table ${tableName} column ${columnKey} has invalid references`,
      );
    }

    if (!references.column) {
      throw new MigrationError(
        `Invalid ${label}: table ${tableName} column ${columnKey} has invalid references`,
      );
    }
  }

  return value as ColumnSnapshot;
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

  if (typeof table.name !== "string") {
    throw new MigrationError(
      `Invalid ${label}: table ${tableKey} missing name`,
    );
  }

  if (!table.name) {
    throw new MigrationError(
      `Invalid ${label}: table ${tableKey} missing name`,
    );
  }

  if (table.name !== tableKey) {
    throw new MigrationError(
      `Invalid ${label}: table key ${tableKey} does not match name ${table.name}`,
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

  return {
    name: table.name,
    columns,
  } satisfies TableSnapshot;
};

export const assertSchemaSnapshot = (value: unknown, label: string) => {
  if (!isPlainObject(value)) {
    throw new MigrationError(`Invalid ${label}: expected a schema object`);
  }

  const record = asRecord(value);

  if (!("tables" in record)) {
    throw new MigrationError(`Invalid ${label}: missing tables`);
  }

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
      index = newline === -1 ? sqlText.length - 1 : newline - 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const close = sqlText.indexOf("*/", index + 2);
      const end = close === -1 ? sqlText.length - 1 : close + 1;
      current += sqlText.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === "$") {
      const tag = sqlText.slice(index).match(DOLLAR_TAG)?.[1];

      if (tag) {
        const close = sqlText.indexOf(tag, index + tag.length);
        const end = close === -1 ? sqlText.length - 1 : close + tag.length - 1;
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

export const renderMigrationSql = (adapter: Adapter, ops: MigrationOp[]) => {
  return getMigrationDialect(adapter).render(ops);
};

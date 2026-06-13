import type { Table } from "../table/types.js";
import type {
  CoerceRelationItemsInput,
  CoerceRowInput,
  ParseIncludeRowsInput,
  ReturningQuery,
} from "./types.js";

const coerceBooleanValue = (val: unknown) => {
  if (val === null) return val;
  if (val === undefined) return val;

  return Boolean(val);
};

const coerceRelationItems = (input: CoerceRelationItemsInput) => {
  const { value, table, nested } = input;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "object" && item !== null) {
        coerceRow({
          row: item as Record<string, unknown>,
          table,
          descriptors: nested,
        });
      }
    }

    return;
  }

  if (typeof value === "object" && value !== null) {
    coerceRow({
      row: value as Record<string, unknown>,
      table,
      descriptors: nested,
    });
  }
};

const getColumnKeysByType = (table: Table) => {
  const boolKeys = new Set<string>();
  const jsonKeys = new Set<string>();

  for (const [key, col] of Object.entries(table.columns)) {
    if (col.type === "boolean") boolKeys.add(key);
    if (col.type === "json") jsonKeys.add(key);
    if (col.type === "jsonb") jsonKeys.add(key);
  }

  return { boolKeys, jsonKeys };
};

const coerceColumnValues = (row: Record<string, unknown>, table: Table) => {
  const { boolKeys, jsonKeys } = getColumnKeysByType(table);

  for (const key of boolKeys) {
    if (key in row) row[key] = coerceBooleanValue(row[key]);
  }

  for (const key of jsonKeys) {
    if (!(key in row)) continue;

    const val = row[key];

    if (typeof val !== "string") continue;

    row[key] = JSON.parse(val);
  }
};

const coerceRelationValue = (input: {
  row: Record<string, unknown>;
  descriptor: CoerceRowInput["descriptors"][number];
}) => {
  const { row, descriptor } = input;
  const value = row[descriptor.name];

  if (value === null) {
    if (descriptor.type === "hasMany") row[descriptor.name] = [];
    return;
  }

  const nested = descriptor.nested ?? [];

  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    coerceRelationItems({ value: parsed, table: descriptor.table, nested });
    row[descriptor.name] = parsed;
    return;
  }

  coerceRelationItems({ value, table: descriptor.table, nested });
};

const coerceRelationValues = (
  row: Record<string, unknown>,
  descriptors: CoerceRowInput["descriptors"],
) => {
  for (const descriptor of descriptors) {
    coerceRelationValue({ row, descriptor });
  }
};

const coerceRow = (input: CoerceRowInput) => {
  const { row, table, descriptors } = input;

  coerceColumnValues(row, table);
  coerceRelationValues(row, descriptors);
};

export const parseIncludeRows = (input: ParseIncludeRowsInput) => {
  const { table, rows, descriptors } = input;

  for (const row of rows) {
    coerceRow({ row, table, descriptors });
  }
};

export const executeQuery = async (
  sql: Bun.SQL,
  table: Table,
  query: ReturningQuery,
) => {
  const rows = [...(await sql.unsafe(query.statement, query.params))];

  parseIncludeRows({ table, rows, descriptors: query.includeDescriptors });

  return rows;
};

import type { Column } from "../column/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import type { BuildSetClausesInput } from "./types.js";

export const serializeParam = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();

  return value;
};

export const serializeColumnValue = (column: Column, value: unknown) => {
  if (column.type !== "json" && column.type !== "jsonb")
    return serializeParam(value);
  if (value === null) return value;
  if (value === undefined) return null;

  return JSON.stringify(value);
};

export const resolveCreateValue = (column: Column, provided: unknown) => {
  if (provided !== undefined) return provided;

  if (column._default) return column._default();

  return null;
};

export const validateFindUniqueWhere = (
  table: Table,
  where: Record<string, unknown>,
) => {
  const entries = Object.entries(where).filter(
    ([, value]) => value !== undefined,
  );
  const keys = entries.map(([key]) => key);

  if (!keys.length) {
    throw new Error("findUnique requires at least one where key");
  }

  let hasUniqueKey = false;

  for (const [key] of entries) {
    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
    }

    if (column._meta.isPrimaryKey || column._meta.isUnique) {
      hasUniqueKey = true;
    }
  }

  if (!hasUniqueKey) {
    throw new Error(
      "findUnique where must include at least one unique or primary key column",
    );
  }
};

export const buildSetClauses = <T extends Table>(
  input: BuildSetClausesInput<T>,
) => {
  const { nextPlaceholder, table, data } = input;
  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [jsKey, value] of Object.entries(data)) {
    if (value === undefined) continue;

    const column = table.columns[jsKey];

    if (!column) continue;

    setClauses.push(
      `${quoteIdentifier(column.sqlName)} = ${nextPlaceholder()}`,
    );
    params.push(serializeColumnValue(column, value));
  }

  return { setClauses, params };
};

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

  if (column._meta.default) return column._meta.default();

  return null;
};

export const bindCreateValue = (
  column: Column,
  provided: unknown,
  nextPlaceholder: () => string,
  params: unknown[],
) => {
  if (provided !== undefined) {
    params.push(serializeColumnValue(column, provided));
    return nextPlaceholder();
  }

  if (column._meta.default) {
    params.push(serializeColumnValue(column, column._meta.default()));
    return nextPlaceholder();
  }

  if (column._meta.dbDefault !== undefined) {
    return column._meta.dbDefault;
  }

  params.push(serializeColumnValue(column, null));

  return nextPlaceholder();
};

export const columnKey = (table: Table, column: object) => {
  const entry = Object.entries(table.columns).find(([, candidate]) => {
    return candidate === column;
  });

  if (!entry) {
    throw new Error(`Unknown column on table ${table.sqlName}`);
  }

  return entry[0];
};

export const primaryKeyOf = (table: Table) => {
  const entry = Object.entries(table.columns).find(([, column]) => {
    return column._meta.isPrimaryKey;
  });

  if (!entry) {
    throw new Error(`Table ${table.sqlName} has no primary key`);
  }

  return entry[0];
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

  for (const [key, value] of entries) {
    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
    }

    if (column._meta.isPrimaryKey || column._meta.isUnique) {
      if (value === null) {
        throw new Error(
          `findUnique where key "${key}" must be non-null on table ${table.sqlName}`,
        );
      }

      hasUniqueKey = true;
    }
  }

  if (!hasUniqueKey) {
    throw new Error(
      "findUnique where must include at least one unique or primary key column",
    );
  }
};

export const parseCursor = (table: Table, cursor: Record<string, unknown>) => {
  const entries = Object.entries(cursor).filter(
    ([, value]) => value !== undefined,
  );
  const entry = entries[0];

  if (entries.length !== 1) {
    throw new Error("cursor requires exactly one unique or primary key column");
  }

  if (!entry) {
    throw new Error("cursor requires exactly one unique or primary key column");
  }

  const [key, value] = entry;
  const column = table.columns[key];

  if (!column) {
    throw new Error(`Unknown cursor key "${key}" on table ${table.sqlName}`);
  }

  if (!column._meta.isPrimaryKey) {
    if (!column._meta.isUnique) {
      throw new Error(
        `cursor key "${key}" must be a unique or primary key column on table ${table.sqlName}`,
      );
    }
  }

  if (value === null) {
    throw new Error(
      `cursor key "${key}" must be non-null on table ${table.sqlName}`,
    );
  }

  return { key, value, column };
};

export const resolveFindManyPagination = (input: {
  table: Table;
  cursor?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc" | undefined>;
  take?: number;
  nextPlaceholder: () => string;
}) => {
  const reverse = input.take !== undefined && input.take < 0;
  const take = input.take === undefined ? undefined : Math.abs(input.take);
  let orderBy: Record<string, "asc" | "desc"> | undefined;

  if (input.orderBy) {
    orderBy = {};

    for (const [key, direction] of Object.entries(input.orderBy)) {
      if (direction === undefined) continue;

      orderBy[key] = direction;
    }
  }

  let cursorSql = "";
  const cursorParams: unknown[] = [];

  if (input.cursor) {
    const { key, value, column } = parseCursor(input.table, input.cursor);

    if (!orderBy) {
      orderBy = { [key]: "asc" };
    }

    const direction = orderBy[key];

    if (direction === undefined) {
      throw new Error(
        `orderBy must include cursor key "${key}" on table ${input.table.sqlName}`,
      );
    }

    const orderKeys = Object.keys(orderBy);

    if (orderKeys.length !== 1) {
      throw new Error(
        `cursor pagination requires a single-column orderBy on table ${input.table.sqlName}`,
      );
    }

    if (orderKeys[0] !== key) {
      throw new Error(
        `orderBy must start with cursor key "${key}" on table ${input.table.sqlName}`,
      );
    }

    const op = !reverse === (direction === "asc") ? ">=" : "<=";

    cursorSql = `${quoteIdentifier(column.sqlName)} ${op} ${input.nextPlaceholder()}`;
    cursorParams.push(serializeColumnValue(column, value));
  }

  if (!orderBy) {
    if (reverse) {
      orderBy = { [primaryKeyOf(input.table)]: "asc" };
    }
  }

  if (reverse) {
    if (orderBy) {
      const flipped: Record<string, "asc" | "desc"> = {};

      for (const [key, direction] of Object.entries(orderBy)) {
        if (direction === "desc") {
          flipped[key] = "asc";
          continue;
        }

        flipped[key] = "desc";
      }

      orderBy = flipped;
    }
  }

  return { take, orderBy, cursorSql, cursorParams };
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

    if (!column) {
      throw new Error(`Unknown data key "${jsKey}" on table ${table.sqlName}`);
    }

    setClauses.push(
      `${quoteIdentifier(column.sqlName)} = ${nextPlaceholder()}`,
    );
    params.push(serializeColumnValue(column, value));
  }

  return { setClauses, params };
};

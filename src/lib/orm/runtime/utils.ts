import type { ColDefs, TableRow, WhereInput } from "../types.js";

export async function expectSingleRow<T>(rows: T[], message: string) {
  if (rows.length === 0) {
    throw new Error(message);
  }

  const first = rows[0];

  if (first === undefined) {
    throw new Error(message);
  }

  return first;
}

export function mergeRows<T extends ColDefs>(
  rows: TableRow<T>[],
  data: Partial<Record<string, unknown>>,
) {
  return rows.map((row) => ({
    ...row,
    ...data,
  }));
}

export function toWhereInput<T extends ColDefs>(value: object) {
  const where: WhereInput<T> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "__proto__") {
      continue;
    }

    if (key === "constructor") {
      continue;
    }

    if (key === "prototype") {
      continue;
    }

    Reflect.set(where, key, entry);
  }

  return where;
}

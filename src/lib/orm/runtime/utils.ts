import type { ColDefs, TableRow, WhereInput } from "../types.js";

export async function expectSingleRow<T>(rows: T[], message: string) {
  const first = rows[0] ?? null;

  if (!first) {
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
    Reflect.set(where, key, entry);
  }

  return where;
}

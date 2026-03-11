import type { ManyRelation, OneRelation } from "./types.js";

export function many<TTable>(
  table: () => TTable,
  foreignKey?: string,
): ManyRelation<TTable> {
  return { kind: "many", table, foreignKey };
}

export function one<TTable>(
  foreignKey: string,
  table: () => TTable,
): OneRelation<TTable> {
  return { kind: "one", foreignKey, table };
}

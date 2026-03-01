import type { ManyRelation, OneRelation } from "./types.js";

export function many<TTable>(table: () => TTable): ManyRelation<TTable> {
  return { kind: "many", table };
}

export function one<TTable>(
  foreignKey: string,
  table: () => TTable,
): OneRelation<TTable> {
  return { kind: "one", foreignKey, table };
}

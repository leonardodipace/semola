import type { Table } from "../table/index.js";
import type { ManyRelation, OneRelation } from "./types.js";

export type {
  IncludeOptions,
  ManyRelation,
  OneRelation,
  Relation,
  WithIncluded,
} from "./types.js";

export const many = <T extends Table>(
  fkColumn: string,
  table: () => T,
): ManyRelation<T> => ({
  type: "many",
  fkColumn,
  table,
});

export const one = <T extends Table>(
  fkColumn: string,
  table: () => T,
): OneRelation<T> => ({
  type: "one",
  fkColumn,
  table,
});

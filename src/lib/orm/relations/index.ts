import type { Table } from "../table/index.js";

export type {
  IncludeOptions,
  ManyRelation,
  OneRelation,
  Relation,
  WithIncluded,
} from "./types.js";

export const many = <T extends Table>(fkColumn: string, table: () => T) => ({
  type: "many" as const,
  fkColumn,
  table,
});

export const one = <T extends Table>(fkColumn: string, table: () => T) => ({
  type: "one" as const,
  fkColumn,
  table,
});

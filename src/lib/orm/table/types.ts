import type { Column } from "../column/types.js";
import type { Index } from "../indexes/types.js";

export type Table<
  TColumns extends Record<string, Column> = Record<string, Column>,
> = {
  sqlName: string;
  columns: TColumns;
  indexes?: Index[];
};

import type { Column } from "../column/types.js";
import type { Index, IndexInput } from "../indexes/types.js";

type DefineTableConfig<TColumns extends Record<string, Column>> = {
  sqlName: string;
  columns: TColumns;
  indexes?: (columns: TColumns) => IndexInput[];
};

const finalizeIndex = (value: IndexInput) => {
  const index: Index = {
    sqlName: value.sqlName,
    columns: value.columns,
    unique: value.unique,
  };

  if (typeof value.where === "string") {
    index.where = value.where;
  }

  return index;
};

export const defineTable = <const TColumns extends Record<string, Column>>(
  config: DefineTableConfig<TColumns>,
) => {
  const table: {
    sqlName: string;
    columns: TColumns;
    indexes?: Index[];
  } = {
    sqlName: config.sqlName,
    columns: config.columns,
  };

  if (config.indexes) {
    table.indexes = config.indexes(config.columns).map(finalizeIndex);
  }

  return table;
};

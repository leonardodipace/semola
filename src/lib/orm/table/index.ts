import type { Check, CheckInput } from "../checks/types.js";
import type { Column } from "../column/types.js";
import { OrmError } from "../errors.js";
import type { Index, IndexInput } from "../indexes/types.js";

type DefineTableConfig<TColumns extends Record<string, Column>> = {
  sqlName: string;
  columns: TColumns;
  indexes?: (columns: TColumns) => IndexInput[];
  checks?: (columns: TColumns) => CheckInput[];
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

const finalizeCheck = (value: CheckInput) => {
  if (!("expression" in value)) {
    throw new OrmError(`Check ${value.sqlName} requires .where(sql)`);
  }

  return {
    sqlName: value.sqlName,
    columns: value.columns,
    expression: value.expression,
  } satisfies Check;
};

export const defineTable = <const TColumns extends Record<string, Column>>(
  config: DefineTableConfig<TColumns>,
) => {
  const table: {
    sqlName: string;
    columns: TColumns;
    indexes?: Index[];
    checks?: Check[];
  } = {
    sqlName: config.sqlName,
    columns: config.columns,
  };

  if (config.indexes) {
    table.indexes = config.indexes(config.columns).map(finalizeIndex);
  }

  if (config.checks) {
    table.checks = config.checks(config.columns).map(finalizeCheck);
  }

  return table;
};

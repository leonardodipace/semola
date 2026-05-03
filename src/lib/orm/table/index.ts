import type { Column } from "../column/types.js";

export const defineTable = <const TColumns extends Record<string, Column>>(
  sqlName: string,
  columns: TColumns,
) => {
  return {
    sqlName,
    columns,
  };
};

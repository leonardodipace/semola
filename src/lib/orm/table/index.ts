export const defineTable = <
  const TColumns extends Record<string, { sqlName: string }>,
>(
  sqlName: string,
  columns: TColumns,
) => {
  return {
    sqlName,
    columns,
  };
};

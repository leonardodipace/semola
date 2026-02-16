import { writeFile } from "node:fs/promises";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Table } from "../table/index.js";
import type { TableDiffOperation } from "./types.js";

const kindToMethod = (kind: ColumnKind) => {
  if (kind === "number") return "number";
  if (kind === "string") return "string";
  if (kind === "boolean") return "boolean";
  if (kind === "date") return "date";
  if (kind === "json") return "json";
  if (kind === "jsonb") return "jsonb";
  return "uuid";
};

const valueToCode = (value: unknown): string => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`;
  }

  return `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
};

const renderColumn = (
  column: Column<ColumnKind, ColumnMeta>,
  builder = "t",
) => {
  let code = `${builder}.${kindToMethod(column.columnKind)}(${JSON.stringify(column.sqlName)})`;

  if (column.meta.primaryKey) {
    code = `${code}.primaryKey()`;
  }

  if (column.meta.notNull) {
    code = `${code}.notNull()`;
  }

  if (column.meta.unique) {
    code = `${code}.unique()`;
  }

  if (column.meta.hasDefault && column.defaultValue !== undefined) {
    code = `${code}.default(${valueToCode(column.defaultValue)})`;
  }

  return `${code};`;
};

const renderCreateTable = (table: Table) => {
  const lines: string[] = [];
  lines.push(
    `await t.createTable(${JSON.stringify(table.sqlName)}, (table) => {`,
  );

  for (const column of Object.values(table.columns)) {
    lines.push(`    ${renderColumn(column, "table")}`);
  }

  lines.push("  });");
  return lines;
};

const renderAddColumn = (
  tableName: string,
  column: Column<ColumnKind, ColumnMeta>,
) => {
  const definition = renderColumn(column, "table").replace(/;$/, "");
  return [
    `await t.addColumn(${JSON.stringify(tableName)}, (table) => {`,
    `    ${definition};`,
    "  });",
  ];
};

const renderOperation = (operation: TableDiffOperation) => {
  if (operation.type === "createTable") {
    return renderCreateTable(operation.table);
  }

  if (operation.type === "addColumn") {
    return renderAddColumn(operation.tableName, operation.column);
  }

  if (operation.type === "dropTable") {
    return [`await t.dropTable(${JSON.stringify(operation.tableName)});`];
  }

  return [
    `await t.dropColumn(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.columnName)});`,
  ];
};

export const generateMigrationSource = (
  up: TableDiffOperation[],
  down: TableDiffOperation[],
) => {
  const upLines = up.flatMap(renderOperation);
  const downLines = down.flatMap(renderOperation);

  if (upLines.length === 0) {
    upLines.push("// No schema changes detected");
  }

  if (downLines.length === 0) {
    downLines.push("// No rollback operations generated");
  }

  return `import { defineMigration } from "semola/orm";

export default defineMigration({
  up: async (t) => {
    ${upLines.join("\n    ")}
  },
  down: async (t) => {
    ${downLines.join("\n    ")}
  },
});
`;
};

export const writeMigrationSource = async (
  filePath: string,
  source: string,
) => {
  await writeFile(filePath, source, "utf8");
};

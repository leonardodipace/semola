import { err, mightThrow, ok } from "../../errors/index.js";
import type { ColumnKind } from "../column/types.js";
import type { ColumnSnapshot, TableSnapshot } from "./snapshot.js";
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

const valueToCode = (value: unknown) => {
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

const renderColumnSnapshot = (column: ColumnSnapshot, builder = "t") => {
  let code = `${builder}.${kindToMethod(column.type)}(${JSON.stringify(column.name)})`;

  if (column.primaryKey) {
    code = `${code}.primaryKey()`;
  }

  if (column.notNull) {
    code = `${code}.notNull()`;
  }

  if (column.unique) {
    code = `${code}.unique()`;
  }

  if (column.hasDefault && column.defaultValue !== undefined) {
    code = `${code}.default(${valueToCode(column.defaultValue)})`;
  }

  if (column.references) {
    code = `${code}.references(${JSON.stringify(column.references.tableName)}, ${JSON.stringify(column.references.columnName)})`;
  }

  if (column.onDelete) {
    code = `${code}.onDelete(${JSON.stringify(column.onDelete)})`;
  }

  return `${code};`;
};

const renderCreateTable = (table: TableSnapshot) => {
  const lines: string[] = [];
  lines.push(`await t.createTable(${JSON.stringify(table.name)}, (table) => {`);

  for (const column of Object.values(table.columns)) {
    lines.push(`    ${renderColumnSnapshot(column, "table")}`);
  }

  lines.push("});");
  return lines;
};

const renderAddColumn = (tableName: string, column: ColumnSnapshot) => {
  const definition = renderColumnSnapshot(column, "table").replace(/;$/, "");
  return [
    `await t.addColumn(${JSON.stringify(tableName)}, (table) => {`,
    `    ${definition};`,
    "});",
  ];
};

const renderAlterColumn = (
  tableName: string,
  columnName: string,
  newColumn: ColumnSnapshot,
) => {
  const definition = renderColumnSnapshot(newColumn, "table").replace(/;$/, "");
  return [
    `await t.alterColumn(${JSON.stringify(tableName)}, ${JSON.stringify(columnName)}, (table) => {`,
    `    ${definition};`,
    "});",
  ];
};

const renderOperation = (operation: TableDiffOperation) => {
  if (operation.type === "createTable") {
    return renderCreateTable(operation.tableSnapshot);
  }

  if (operation.type === "addColumn") {
    return renderAddColumn(operation.tableName, operation.columnSnapshot);
  }

  if (operation.type === "alterColumn") {
    return renderAlterColumn(
      operation.tableName,
      operation.columnName,
      operation.newColumn,
    );
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
  const [writeError] = await mightThrow(Bun.write(filePath, source));
  if (writeError) {
    return err(
      "InternalServerError",
      writeError instanceof Error
        ? writeError.message
        : "Failed to write migration",
    );
  }

  return ok(filePath);
};

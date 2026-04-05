import type {
  ColumnSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from "../types.js";
import { buildColumnDefinition, buildForeignKeyConstraint } from "./column.js";
import { quoteIdentifier } from "./identifiers.js";

function createCopyColumns(fromTable: TableSnapshot, toTable: TableSnapshot) {
  const fromColumnsByKey = new Map(
    Object.values(fromTable.columns).map((column) => [column.key, column]),
  );

  const fromColumnsBySqlName = new Map(
    Object.values(fromTable.columns).map((column) => [column.sqlName, column]),
  );

  return Object.values(toTable.columns).flatMap((column) => {
    const fromColumnByKey = fromColumnsByKey.get(column.key);

    if (fromColumnByKey) {
      return [
        {
          targetSqlName: column.sqlName,
          sourceSqlName: fromColumnByKey.sqlName,
        },
      ];
    }

    const fromColumnBySqlName = fromColumnsBySqlName.get(column.sqlName);

    if (!fromColumnBySqlName) {
      return [];
    }

    return [
      {
        targetSqlName: column.sqlName,
        sourceSqlName: fromColumnBySqlName.sqlName,
      },
    ];
  });
}

export function createTableSql(
  dialect: SchemaSnapshot["dialect"],
  table: TableSnapshot,
) {
  const shouldInlineForeignKeys = dialect === "sqlite";

  const columnDefinitions = Object.values(table.columns).map((column) =>
    buildColumnDefinition(dialect, column, {
      includeReferences: shouldInlineForeignKeys,
    }),
  );

  if (shouldInlineForeignKeys) {
    const tableName = quoteIdentifier(dialect, table.tableName);
    return `CREATE TABLE ${tableName} (\n  ${columnDefinitions.join(",\n  ")}\n)`;
  }

  const foreignKeys: string[] = [];

  for (const column of Object.values(table.columns)) {
    const foreignKey = buildForeignKeyConstraint(dialect, column);

    if (!foreignKey) {
      continue;
    }

    foreignKeys.push(foreignKey);
  }

  const definitions = [...columnDefinitions, ...foreignKeys];
  const tableName = quoteIdentifier(dialect, table.tableName);

  return `CREATE TABLE ${tableName} (\n  ${definitions.join(",\n  ")}\n)`;
}

export function dropTableSql(
  dialect: SchemaSnapshot["dialect"],
  table: TableSnapshot,
) {
  const tableName = quoteIdentifier(dialect, table.tableName);
  return `DROP TABLE ${tableName}`;
}

export function addColumnSql(
  dialect: SchemaSnapshot["dialect"],
  tableName: string,
  column: ColumnSnapshot,
) {
  const table = quoteIdentifier(dialect, tableName);
  return `ALTER TABLE ${table} ADD COLUMN ${buildColumnDefinition(dialect, column)}`;
}

export function dropColumnSql(
  dialect: SchemaSnapshot["dialect"],
  tableName: string,
  column: ColumnSnapshot,
) {
  const table = quoteIdentifier(dialect, tableName);
  const col = quoteIdentifier(dialect, column.sqlName);
  return `ALTER TABLE ${table} DROP COLUMN ${col}`;
}

export function renameColumnSql(
  dialect: SchemaSnapshot["dialect"],
  tableName: string,
  fromSqlName: string,
  toSqlName: string,
) {
  const table = quoteIdentifier(dialect, tableName);
  const fromCol = quoteIdentifier(dialect, fromSqlName);
  const toCol = quoteIdentifier(dialect, toSqlName);
  return `ALTER TABLE ${table} RENAME COLUMN ${fromCol} TO ${toCol}`;
}

export function setColumnNotNullSql(
  dialect: SchemaSnapshot["dialect"],
  tableName: string,
  columnSqlName: string,
) {
  const table = quoteIdentifier(dialect, tableName);
  const col = quoteIdentifier(dialect, columnSqlName);
  return `ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL`;
}

export function dropColumnNotNullSql(
  dialect: SchemaSnapshot["dialect"],
  tableName: string,
  columnSqlName: string,
) {
  const table = quoteIdentifier(dialect, tableName);
  const col = quoteIdentifier(dialect, columnSqlName);
  return `ALTER TABLE ${table} ALTER COLUMN ${col} DROP NOT NULL`;
}

export function rebuildTableSql(
  dialect: SchemaSnapshot["dialect"],
  fromTable: TableSnapshot,
  toTable: TableSnapshot,
) {
  if (dialect !== "sqlite") {
    return [];
  }

  const tableName = quoteIdentifier(dialect, toTable.tableName);
  const tempTableName = quoteIdentifier(
    dialect,
    `__semola_tmp_${toTable.tableName}`,
  );

  const createSql = createTableSql(dialect, toTable);
  const copyColumns = createCopyColumns(fromTable, toTable);

  const statements = [
    `ALTER TABLE ${tableName} RENAME TO ${tempTableName}`,
    createSql,
  ];

  if (copyColumns.length > 0) {
    const targetColumns = copyColumns.map((column) =>
      quoteIdentifier(dialect, column.targetSqlName),
    );

    const sourceColumns = copyColumns.map((column) =>
      quoteIdentifier(dialect, column.sourceSqlName),
    );

    statements.push(
      `INSERT INTO ${tableName} (${targetColumns.join(", ")}) SELECT ${sourceColumns.join(", ")} FROM ${tempTableName}`,
    );
  }

  statements.push(`DROP TABLE ${tempTableName}`);

  return statements;
}

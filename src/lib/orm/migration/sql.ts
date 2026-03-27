import type {
  ColumnSnapshot,
  MigrationOperation,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

function quoteIdentifier(
  dialect: SchemaSnapshot["dialect"],
  identifier: string,
) {
  if (dialect === "mysql") {
    return `\`${identifier.replaceAll("`", "``")}\``;
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

function columnType(
  dialect: SchemaSnapshot["dialect"],
  kind: ColumnSnapshot["kind"],
) {
  if (kind === "uuid") {
    if (dialect === "postgres") return "UUID";
    if (dialect === "mysql") return "CHAR(36)";
    return "TEXT";
  }
  if (kind === "string") {
    if (dialect === "mysql") return "VARCHAR(255)";
    return "TEXT";
  }
  if (kind === "number") {
    if (dialect === "mysql") return "INT";
    return "INTEGER";
  }
  if (kind === "boolean") {
    if (dialect === "sqlite") return "INTEGER";
    if (dialect === "mysql") return "TINYINT(1)";
    return "BOOLEAN";
  }
  if (kind === "json") {
    if (dialect === "sqlite") return "TEXT";
    return "JSON";
  }
  if (kind === "jsonb") {
    if (dialect === "postgres") return "JSONB";
    if (dialect === "sqlite") return "TEXT";
    return "JSON";
  }
  if (dialect === "mysql") {
    return "DATETIME";
  }
  if (dialect === "sqlite") {
    return "TEXT";
  }
  return "TIMESTAMP";
}

function uuidDefaultExpression(dialect: SchemaSnapshot["dialect"]) {
  if (dialect === "postgres") {
    return "gen_random_uuid()";
  }

  if (dialect === "mysql") {
    return "UUID()";
  }

  // SQLite requires expressions to be wrapped in parentheses
  return "(lower(hex(randomblob(16))))";
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function serializeDefaultValue(
  dialect: SchemaSnapshot["dialect"],
  column: ColumnSnapshot,
) {
  if (column.defaultKind !== "value") {
    return null;
  }

  const value = column.defaultValue;

  if (value === null) {
    return "NULL";
  }

  if (column.kind === "json") {
    return quoteLiteral(JSON.stringify(value));
  }

  if (column.kind === "jsonb") {
    return quoteLiteral(JSON.stringify(value));
  }

  if (column.kind === "boolean") {
    if (typeof value !== "boolean") {
      return null;
    }
    if (dialect === "sqlite") {
      return value ? "1" : "0";
    }
    return value ? "TRUE" : "FALSE";
  }

  if (column.kind === "number") {
    if (typeof value !== "number") {
      return null;
    }

    if (Number.isNaN(value)) {
      return null;
    }
    return String(value);
  }

  if (value instanceof Date) {
    return quoteLiteral(value.toISOString());
  }

  if (typeof value === "string") {
    return quoteLiteral(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  return quoteLiteral(JSON.stringify(value));
}

function buildColumnDefinition(
  dialect: SchemaSnapshot["dialect"],
  column: ColumnSnapshot,
  options?: {
    includeReferences?: boolean;
  },
) {
  const includeReferences = options?.includeReferences ?? true;

  const parts = [
    quoteIdentifier(dialect, column.sqlName),
    columnType(dialect, column.kind),
  ];

  if (column.isPrimaryKey) {
    parts.push("PRIMARY KEY");
  }

  if (column.isNotNull) {
    parts.push("NOT NULL");
  }

  if (column.isUnique) {
    parts.push("UNIQUE");
  }

  const serializedDefault = serializeDefaultValue(dialect, column);
  if (serializedDefault) {
    parts.push("DEFAULT", serializedDefault);
  }

  if (column.kind === "uuid" && column.isPrimaryKey && !column.hasDefault) {
    parts.push("DEFAULT", uuidDefaultExpression(dialect));
  }

  if (includeReferences && column.referencesTable && column.referencesColumn) {
    parts.push(
      "REFERENCES",
      quoteIdentifier(dialect, column.referencesTable),
      `(${quoteIdentifier(dialect, column.referencesColumn)})`,
    );
    if (column.onDeleteAction) {
      parts.push("ON DELETE", column.onDeleteAction);
    }
  }

  return parts.join(" ");
}

function buildForeignKeyConstraint(
  dialect: SchemaSnapshot["dialect"],
  column: ColumnSnapshot,
) {
  if (!column.referencesTable) {
    return null;
  }

  if (!column.referencesColumn) {
    return null;
  }

  const parts = [
    "FOREIGN KEY",
    `(${quoteIdentifier(dialect, column.sqlName)})`,
    "REFERENCES",
    quoteIdentifier(dialect, column.referencesTable),
    `(${quoteIdentifier(dialect, column.referencesColumn)})`,
  ];

  if (column.onDeleteAction) {
    parts.push("ON DELETE", column.onDeleteAction);
  }

  return parts.join(" ");
}

function createTableSql(
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

function dropTableSql(
  dialect: SchemaSnapshot["dialect"],
  table: TableSnapshot,
) {
  const tableName = quoteIdentifier(dialect, table.tableName);
  return `DROP TABLE ${tableName}`;
}

function addColumnSql(
  dialect: SchemaSnapshot["dialect"],
  tableName: string,
  column: ColumnSnapshot,
) {
  const table = quoteIdentifier(dialect, tableName);
  return `ALTER TABLE ${table} ADD COLUMN ${buildColumnDefinition(dialect, column)}`;
}

function dropColumnSql(
  dialect: SchemaSnapshot["dialect"],
  tableName: string,
  column: ColumnSnapshot,
) {
  const table = quoteIdentifier(dialect, tableName);
  const col = quoteIdentifier(dialect, column.sqlName);
  return `ALTER TABLE ${table} DROP COLUMN ${col}`;
}

function rebuildTableSql(
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

  const fromColumns = new Set(
    Object.values(fromTable.columns).map((column) => column.sqlName),
  );

  const copyColumns = Object.values(toTable.columns)
    .filter((column) => fromColumns.has(column.sqlName))
    .map((column) => quoteIdentifier(dialect, column.sqlName));

  const statements = [
    `ALTER TABLE ${tableName} RENAME TO ${tempTableName}`,
    createSql,
  ];

  if (copyColumns.length > 0) {
    statements.push(
      `INSERT INTO ${tableName} (${copyColumns.join(", ")}) SELECT ${copyColumns.join(", ")} FROM ${tempTableName}`,
    );
  }

  statements.push(`DROP TABLE ${tempTableName}`);

  return statements;
}

function reverseOperation(operation: MigrationOperation) {
  if (operation.kind === "create-table") {
    return { kind: "drop-table", table: operation.table } as const;
  }
  if (operation.kind === "drop-table") {
    return { kind: "create-table", table: operation.table } as const;
  }
  if (operation.kind === "add-column") {
    return {
      kind: "drop-column",
      tableName: operation.tableName,
      column: operation.column,
    } as const;
  }
  if (operation.kind === "rebuild-table") {
    return {
      kind: "rebuild-table",
      fromTable: operation.toTable,
      toTable: operation.fromTable,
    } as const;
  }
  return {
    kind: "add-column",
    tableName: operation.tableName,
    column: operation.column,
  } as const;
}

function operationToStatements(
  dialect: SchemaSnapshot["dialect"],
  operation: MigrationOperation,
) {
  if (operation.kind === "create-table") {
    return [createTableSql(dialect, operation.table)];
  }
  if (operation.kind === "drop-table") {
    return [dropTableSql(dialect, operation.table)];
  }
  if (operation.kind === "add-column") {
    return [addColumnSql(dialect, operation.tableName, operation.column)];
  }
  if (operation.kind === "rebuild-table") {
    return rebuildTableSql(dialect, operation.fromTable, operation.toTable);
  }
  return [dropColumnSql(dialect, operation.tableName, operation.column)];
}

function joinStatements(statements: string[]) {
  if (statements.length === 0) {
    return "";
  }
  return `${statements.join(";\n")};\n`;
}

export function buildUpSql(
  dialect: SchemaSnapshot["dialect"],
  operations: MigrationOperation[],
) {
  const statements = operations.flatMap((operation) =>
    operationToStatements(dialect, operation),
  );

  const hasRebuildOperation = operations.some(
    (operation) => operation.kind === "rebuild-table",
  );

  if (dialect === "sqlite" && hasRebuildOperation) {
    const wrappedStatements = [
      "PRAGMA foreign_keys = OFF",
      "BEGIN",
      ...statements,
      "COMMIT",
      "PRAGMA foreign_keys = ON",
    ];

    return joinStatements(wrappedStatements);
  }

  return joinStatements(statements);
}

export function buildDownSql(
  dialect: SchemaSnapshot["dialect"],
  operations: MigrationOperation[],
) {
  const reversed = [...operations]
    .reverse()
    .map((operation) => reverseOperation(operation));
  const statements = reversed.flatMap((operation) =>
    operationToStatements(dialect, operation),
  );

  const hasRebuildOperation = reversed.some(
    (operation) => operation.kind === "rebuild-table",
  );

  if (dialect === "sqlite" && hasRebuildOperation) {
    const wrappedStatements = [
      "PRAGMA foreign_keys = OFF",
      "BEGIN",
      ...statements,
      "COMMIT",
      "PRAGMA foreign_keys = ON",
    ];

    return joinStatements(wrappedStatements);
  }

  return joinStatements(statements);
}

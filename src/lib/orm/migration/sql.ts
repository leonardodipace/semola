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
  return "lower(hex(randomblob(16)))";
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
) {
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

  if (column.referencesTable && column.referencesColumn) {
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

function createTableSql(
  dialect: SchemaSnapshot["dialect"],
  table: TableSnapshot,
) {
  const definitions = Object.values(table.columns).map((column) =>
    buildColumnDefinition(dialect, column),
  );
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
  return {
    kind: "add-column",
    tableName: operation.tableName,
    column: operation.column,
  } as const;
}

function operationToSql(
  dialect: SchemaSnapshot["dialect"],
  operation: MigrationOperation,
) {
  if (operation.kind === "create-table") {
    return createTableSql(dialect, operation.table);
  }
  if (operation.kind === "drop-table") {
    return dropTableSql(dialect, operation.table);
  }
  if (operation.kind === "add-column") {
    return addColumnSql(dialect, operation.tableName, operation.column);
  }
  return dropColumnSql(dialect, operation.tableName, operation.column);
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
  const statements = operations.map((operation) =>
    operationToSql(dialect, operation),
  );
  return joinStatements(statements);
}

export function buildDownSql(
  dialect: SchemaSnapshot["dialect"],
  operations: MigrationOperation[],
) {
  const reversed = [...operations]
    .reverse()
    .map((operation) => reverseOperation(operation));
  const statements = reversed.map((operation) =>
    operationToSql(dialect, operation),
  );
  return joinStatements(statements);
}

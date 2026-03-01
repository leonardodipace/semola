import type { MigrationOperation, SchemaSnapshot } from "./types.js";

function stableValue(value: unknown) {
  if (value === undefined) return "__undefined__";
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function defaultsEqual(
  left: SchemaSnapshot["tables"][string]["columns"][string],
  right: SchemaSnapshot["tables"][string]["columns"][string],
) {
  const leftKind = left.defaultKind ?? null;
  const rightKind = right.defaultKind ?? null;
  if (leftKind !== rightKind) {
    return false;
  }

  if (leftKind !== "value") {
    return true;
  }

  return stableValue(left.defaultValue) === stableValue(right.defaultValue);
}

function columnsEqual(
  left: SchemaSnapshot["tables"][string]["columns"][string],
  right: SchemaSnapshot["tables"][string]["columns"][string],
) {
  if (left.sqlName !== right.sqlName) return false;
  if (left.kind !== right.kind) return false;
  if (left.isPrimaryKey !== right.isPrimaryKey) return false;
  if (left.isNotNull !== right.isNotNull) return false;
  if (left.isUnique !== right.isUnique) return false;
  if (left.hasDefault !== right.hasDefault) return false;
  if (!defaultsEqual(left, right)) return false;
  if (left.referencesTable !== right.referencesTable) return false;
  if (left.referencesColumn !== right.referencesColumn) return false;
  if (left.onDeleteAction !== right.onDeleteAction) return false;
  return true;
}

export function diffSnapshots(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
) {
  const operations: MigrationOperation[] = [];

  for (const [tableKey, oldTable] of Object.entries(previous.tables)) {
    const newTable = current.tables[tableKey];
    if (!newTable) {
      operations.push({ kind: "drop-table", table: oldTable });
    }
  }

  for (const [tableKey, newTable] of Object.entries(current.tables)) {
    const oldTable = previous.tables[tableKey];
    if (!oldTable) {
      operations.push({ kind: "create-table", table: newTable });
      continue;
    }

    const oldBySqlName = new Map(
      Object.values(oldTable.columns).map((c) => [c.sqlName, c]),
    );

    const newBySqlName = new Map(
      Object.values(newTable.columns).map((c) => [c.sqlName, c]),
    );

    for (const [sqlName, oldColumn] of oldBySqlName) {
      if (!newBySqlName.has(sqlName)) {
        operations.push({
          kind: "drop-column",
          tableName: newTable.tableName,
          column: oldColumn,
        });
      }
    }

    for (const [sqlName, newColumn] of newBySqlName) {
      const oldColumn = oldBySqlName.get(sqlName);

      if (!oldColumn) {
        operations.push({
          kind: "add-column",
          tableName: newTable.tableName,
          column: newColumn,
        });

        continue;
      }

      if (!columnsEqual(oldColumn, newColumn)) {
        operations.push({
          kind: "drop-column",
          tableName: newTable.tableName,
          column: oldColumn,
        });

        operations.push({
          kind: "add-column",
          tableName: newTable.tableName,
          column: newColumn,
        });
      }
    }
  }

  return operations;
}

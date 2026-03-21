import type { MigrationOperation, SchemaSnapshot } from "./types.js";

const UNDEFINED_SENTINEL = Object.freeze({});

function stableValue(value: unknown) {
  if (value === undefined) return UNDEFINED_SENTINEL;
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

function referencedTablesFor(table: SchemaSnapshot["tables"][string]) {
  const referenced = new Set<string>();

  for (const column of Object.values(table.columns)) {
    if (!column.referencesTable) {
      continue;
    }

    referenced.add(column.referencesTable);
  }

  return referenced;
}

function orderTablesByDependencies(
  tables: Array<SchemaSnapshot["tables"][string]>,
) {
  const byName = new Map(tables.map((table) => [table.tableName, table]));
  const incoming = new Map<string, number>();
  const edges = new Map<string, Set<string>>();

  for (const table of tables) {
    incoming.set(table.tableName, 0);
    edges.set(table.tableName, new Set());
  }

  for (const table of tables) {
    const refs = referencedTablesFor(table);

    for (const referencedTableName of refs) {
      if (!byName.has(referencedTableName)) {
        continue;
      }

      const dependents = edges.get(referencedTableName);
      if (!dependents) {
        continue;
      }

      if (dependents.has(table.tableName)) {
        continue;
      }

      dependents.add(table.tableName);

      const currentIncoming = incoming.get(table.tableName) ?? 0;
      incoming.set(table.tableName, currentIncoming + 1);
    }
  }

  const ready = [...tables]
    .filter((table) => (incoming.get(table.tableName) ?? 0) === 0)
    .map((table) => table.tableName)
    .sort();

  const ordered: Array<SchemaSnapshot["tables"][string]> = [];

  while (ready.length > 0) {
    const tableName = ready.shift();
    if (!tableName) {
      break;
    }

    const table = byName.get(tableName);
    if (!table) {
      continue;
    }

    ordered.push(table);

    const dependents = edges.get(tableName);
    if (!dependents) {
      continue;
    }

    for (const dependentName of [...dependents].sort()) {
      const currentIncoming = incoming.get(dependentName);
      if (currentIncoming === undefined) {
        continue;
      }

      const nextIncoming = currentIncoming - 1;
      incoming.set(dependentName, nextIncoming);

      if (nextIncoming === 0) {
        ready.push(dependentName);
        ready.sort();
      }
    }
  }

  if (ordered.length === tables.length) {
    return ordered;
  }

  const orderedNames = new Set(ordered.map((table) => table.tableName));
  const remaining = [...tables]
    .filter((table) => !orderedNames.has(table.tableName))
    .sort((left, right) => left.tableName.localeCompare(right.tableName));

  return [...ordered, ...remaining];
}

function orderCreateTableOperations(
  operations: Array<Extract<MigrationOperation, { kind: "create-table" }>>,
): Array<Extract<MigrationOperation, { kind: "create-table" }>> {
  const orderedTables = orderTablesByDependencies(
    operations.map((operation) => operation.table),
  );

  return orderedTables.map((table) => ({
    kind: "create-table",
    table,
  }));
}

function orderDropTableOperations(
  operations: Array<Extract<MigrationOperation, { kind: "drop-table" }>>,
): Array<Extract<MigrationOperation, { kind: "drop-table" }>> {
  const orderedTables = orderTablesByDependencies(
    operations.map((operation) => operation.table),
  );

  return [...orderedTables].reverse().map((table) => ({
    kind: "drop-table",
    table,
  }));
}

export function diffSnapshots(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
) {
  const dropTableOperations: Array<
    Extract<MigrationOperation, { kind: "drop-table" }>
  > = [];
  const createTableOperations: Array<
    Extract<MigrationOperation, { kind: "create-table" }>
  > = [];
  const dropColumnOperations: Array<
    Extract<MigrationOperation, { kind: "drop-column" }>
  > = [];
  const addColumnOperations: Array<
    Extract<MigrationOperation, { kind: "add-column" }>
  > = [];

  for (const [tableKey, oldTable] of Object.entries(previous.tables)) {
    const newTable = current.tables[tableKey];
    if (!newTable) {
      dropTableOperations.push({ kind: "drop-table", table: oldTable });
    }
  }

  for (const [tableKey, newTable] of Object.entries(current.tables)) {
    const oldTable = previous.tables[tableKey];
    if (!oldTable) {
      createTableOperations.push({ kind: "create-table", table: newTable });
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
        dropColumnOperations.push({
          kind: "drop-column",
          tableName: newTable.tableName,
          column: oldColumn,
        });
      }
    }

    for (const [sqlName, newColumn] of newBySqlName) {
      const oldColumn = oldBySqlName.get(sqlName);

      if (!oldColumn) {
        addColumnOperations.push({
          kind: "add-column",
          tableName: newTable.tableName,
          column: newColumn,
        });

        continue;
      }

      if (!columnsEqual(oldColumn, newColumn)) {
        dropColumnOperations.push({
          kind: "drop-column",
          tableName: newTable.tableName,
          column: oldColumn,
        });

        addColumnOperations.push({
          kind: "add-column",
          tableName: newTable.tableName,
          column: newColumn,
        });
      }
    }
  }

  return [
    ...dropColumnOperations,
    ...orderDropTableOperations(dropTableOperations),
    ...orderCreateTableOperations(createTableOperations),
    ...addColumnOperations,
  ];
}

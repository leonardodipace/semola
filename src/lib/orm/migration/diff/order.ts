import type { MigrationOperation, SchemaSnapshot } from "../types.js";

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

export function orderCreateTableOperations(
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

export function orderDropTableOperations(
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

export function orderRebuildTableOperations(
  operations: Array<Extract<MigrationOperation, { kind: "rebuild-table" }>>,
): Array<Extract<MigrationOperation, { kind: "rebuild-table" }>> {
  return [...operations].sort((left, right) =>
    left.toTable.tableName.localeCompare(right.toTable.tableName),
  );
}

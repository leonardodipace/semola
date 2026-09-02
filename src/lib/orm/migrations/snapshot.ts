import type { Check, CheckSnapshot } from "../checks/types.js";
import type { Column } from "../column/types.js";
import { MigrationError } from "../errors.js";
import type { Index, IndexSnapshot } from "../indexes/types.js";
import type { Table } from "../table/types.js";
import type { ColumnSnapshot, TableSnapshot } from "./types.js";

const findReferencedColumn = (
  tables: Record<string, Table>,
  referenced: { sqlName: string },
) => {
  for (const table of Object.values(tables)) {
    for (const column of Object.values(table.columns)) {
      if (column === referenced) {
        return {
          table: table.sqlName,
          column: column.sqlName,
        };
      }
    }
  }

  return undefined;
};

const snapshotColumn = (
  column: Column,
  tableName: string,
  tables: Record<string, Table>,
) => {
  const snapshot: ColumnSnapshot = {
    name: column.sqlName,
    type: column.type,
    isNullable: column._meta.isNullable,
    isPrimaryKey: column._meta.isPrimaryKey,
    isUnique: column._meta.isUnique,
  };

  if (column.sqlType) {
    snapshot.sqlType = column.sqlType;
  }

  if (column._meta.dbDefault !== undefined) {
    snapshot.dbDefault = column._meta.dbDefault;
  }

  if (column.type === "enum" && column.enumValues) {
    snapshot.enumValues = [...column.enumValues];
  }

  if (column.references?.tableColumn) {
    const referenced = findReferencedColumn(
      tables,
      column.references.tableColumn(),
    );

    if (!referenced) {
      throw new MigrationError(
        `Column ${tableName}.${column.sqlName} references a column that is not in createOrm({ tables })`,
      );
    }

    snapshot.references = referenced;
  }

  return snapshot;
};

const assertForeignKeyTypes = (tables: Record<string, TableSnapshot>) => {
  for (const table of Object.values(tables)) {
    for (const column of Object.values(table.columns)) {
      if (!column.references) continue;

      const target = tables[column.references.table];

      if (!target) continue;

      const referenced = target.columns[column.references.column];

      if (!referenced) continue;

      if (column.type === referenced.type) {
        if (column.sqlType === referenced.sqlType) continue;
      }

      throw new MigrationError(
        `Column ${table.name}.${column.name} type ${column.sqlType ?? column.type} does not match referenced ${column.references.table}.${column.references.column} type ${referenced.sqlType ?? referenced.type}`,
      );
    }
  }
};

const snapshotIndex = (index: Index, table: Table) => {
  const columnSqlNames = new Set(
    Object.values(table.columns).map((column) => column.sqlName),
  );
  const columns: string[] = [];

  for (const column of index.columns) {
    if (!columnSqlNames.has(column.sqlName)) {
      throw new MigrationError(
        `Index ${index.sqlName} references column ${column.sqlName} which is not on table ${table.sqlName}`,
      );
    }

    columns.push(column.sqlName);
  }

  if (columns.length === 0) {
    throw new MigrationError(
      `Index ${index.sqlName} on table ${table.sqlName} requires at least one column`,
    );
  }

  const snapshot: IndexSnapshot = {
    name: index.sqlName,
    table: table.sqlName,
    columns,
    unique: index.unique,
  };

  if (index.where !== undefined) {
    if (typeof index.where !== "string") {
      throw new MigrationError(
        `Index ${index.sqlName} on table ${table.sqlName} has invalid where clause`,
      );
    }

    snapshot.where = index.where;
  }

  return snapshot;
};

const assertUniqueCheckNames = (tables: Record<string, TableSnapshot>) => {
  const seen = new Map<string, string>();

  for (const table of Object.values(tables)) {
    for (const check of Object.values(table.checks)) {
      const existing = seen.get(check.name);

      if (existing) {
        throw new MigrationError(
          `Duplicate check name ${check.name} on tables ${existing} and ${table.name}`,
        );
      }

      seen.set(check.name, table.name);
    }
  }
};

const snapshotCheck = (check: Check, table: Table) => {
  const columnSqlNames = new Set(
    Object.values(table.columns).map((column) => column.sqlName),
  );
  const columns: string[] = [];

  for (const column of check.columns) {
    if (!columnSqlNames.has(column.sqlName)) {
      throw new MigrationError(
        `Check ${check.sqlName} references column ${column.sqlName} which is not on table ${table.sqlName}`,
      );
    }

    columns.push(column.sqlName);
  }

  if (columns.length === 0) {
    throw new MigrationError(
      `Check ${check.sqlName} on table ${table.sqlName} requires at least one column`,
    );
  }

  if (typeof check.expression !== "string") {
    throw new MigrationError(
      `Check ${check.sqlName} on table ${table.sqlName} has invalid expression`,
    );
  }

  if (!check.expression.trim()) {
    throw new MigrationError(
      `Check ${check.sqlName} on table ${table.sqlName} has invalid expression`,
    );
  }

  return {
    name: check.sqlName,
    table: table.sqlName,
    expression: check.expression,
    columns,
  } satisfies CheckSnapshot;
};

const assertUniqueIndexNames = (tables: Record<string, TableSnapshot>) => {
  const seen = new Map<string, string>();

  for (const table of Object.values(tables)) {
    for (const index of Object.values(table.indexes)) {
      const existing = seen.get(index.name);

      if (existing) {
        throw new MigrationError(
          `Duplicate index name ${index.name} on tables ${existing} and ${table.name}`,
        );
      }

      seen.set(index.name, table.name);
    }
  }
};

const snapshotTable = (table: Table, tables: Record<string, Table>) => {
  const columns: Record<string, ColumnSnapshot> = {};

  for (const column of Object.values(table.columns)) {
    columns[column.sqlName] = snapshotColumn(column, table.sqlName, tables);
  }

  const indexes: Record<string, IndexSnapshot> = {};

  if (table.indexes) {
    for (const index of table.indexes) {
      if (indexes[index.sqlName]) {
        throw new MigrationError(
          `Duplicate index name ${index.sqlName} on table ${table.sqlName}`,
        );
      }

      indexes[index.sqlName] = snapshotIndex(index, table);
    }
  }

  const checks: Record<string, CheckSnapshot> = {};

  if (table.checks) {
    for (const check of table.checks) {
      if (checks[check.sqlName]) {
        throw new MigrationError(
          `Duplicate check name ${check.sqlName} on table ${table.sqlName}`,
        );
      }

      checks[check.sqlName] = snapshotCheck(check, table);
    }
  }

  return {
    name: table.sqlName,
    columns,
    indexes,
    checks,
  };
};

export const snapshotSchema = (tables: Record<string, Table>) => {
  const result: Record<string, TableSnapshot> = {};

  for (const table of Object.values(tables)) {
    result[table.sqlName] = snapshotTable(table, tables);
  }

  assertForeignKeyTypes(result);
  assertUniqueIndexNames(result);
  assertUniqueCheckNames(result);

  return { tables: result };
};

export const emptySchema = () => {
  return { tables: {} };
};

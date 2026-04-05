import type { ColumnDef } from "../../column.js";
import type { ColumnKind, ColumnMetaBase } from "../../types.js";
import type { SchemaSnapshot } from "../types.js";

function buildColumnOwners(orm: {
  tables: Record<
    string,
    {
      tableName: string;
      columns: Record<string, ColumnDef<ColumnKind, ColumnMetaBase, unknown>>;
    }
  >;
}) {
  const owners = new Map<
    ColumnDef<ColumnKind, ColumnMetaBase, unknown>,
    { tableName: string; sqlName: string }
  >();

  for (const table of Object.values(orm.tables)) {
    for (const column of Object.values(table.columns)) {
      owners.set(column, {
        tableName: table.tableName,
        sqlName: column.meta.sqlName,
      });
    }
  }

  return owners;
}

export function buildSchemaSnapshot(orm: {
  dialect: "postgres" | "mysql" | "sqlite";
  tables: Record<
    string,
    {
      tableName: string;
      columns: Record<string, ColumnDef<ColumnKind, ColumnMetaBase, unknown>>;
    }
  >;
}) {
  const owners = buildColumnOwners(orm);

  const tables = Object.fromEntries(
    Object.entries(orm.tables).map(([tableKey, table]) => {
      const columns = Object.fromEntries(
        Object.entries(table.columns).map(([columnKey, column]) => {
          let referencesTable: string | null = null;
          let referencesColumn: string | null = null;

          if (column.meta.references) {
            const targetColumn = column.meta.references();
            const owner = owners.get(targetColumn);

            if (owner) {
              referencesTable = owner.tableName;
              referencesColumn = owner.sqlName;
            }
          }

          return [
            columnKey,
            {
              key: columnKey,
              sqlName: column.meta.sqlName,
              kind: column.kind,
              isSqlArray: column.meta.isSqlArray,
              isPrimaryKey: column.meta.isPrimaryKey,
              isNotNull: column.meta.isNotNull,
              isUnique: column.meta.isUnique,
              hasDefault: column.meta.hasDefault,
              defaultKind: column.meta.defaultKind,
              defaultValue: column.meta.defaultValue,
              referencesTable,
              referencesColumn,
              onDeleteAction: column.meta.onDeleteAction,
            },
          ];
        }),
      );

      return [
        tableKey,
        {
          key: tableKey,
          tableName: table.tableName,
          columns,
        },
      ];
    }),
  );

  const snapshot: SchemaSnapshot = {
    dialect: orm.dialect,
    tables,
  };

  return snapshot;
}

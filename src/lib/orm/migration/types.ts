import type { OrmDialect } from "../core/types.js";
import type { Table } from "../table/index.js";
import type { SchemaBuilder } from "./builder.js";
import type { ColumnSnapshot, TableSnapshot } from "./snapshot.js";

export type MigrationDefinition = {
  up: (t: SchemaBuilder) => void | Promise<void>;
  down: (t: SchemaBuilder) => void | Promise<void>;
};

export type Migration = MigrationDefinition & {
  version: string;
  name: string;
  filePath: string;
};

export type MigrationStatus = {
  version: string;
  name: string;
  applied: boolean;
  appliedAt: string | null;
};

export type AppliedMigration = {
  version: string;
  name: string;
  appliedAt: string;
};

export type MigrationFile = {
  version: string;
  name: string;
  filePath: string;
};

export type MigrationCreateOptions = {
  name: string;
  tables: Record<string, Table>;
};

export type SemolaMigrationConfig = {
  orm: {
    dialect: OrmDialect;
    url: string;
    schema: {
      path: string;
      exportName?: string;
    };
  };
};

export type TableDiffOperation =
  | {
      type: "createTable";
      tableSnapshot: TableSnapshot;
    }
  | {
      type: "addColumn";
      tableName: string;
      columnSnapshot: ColumnSnapshot;
    }
  | {
      type: "dropTable";
      tableName: string;
    }
  | {
      type: "dropColumn";
      tableName: string;
      columnName: string;
    }
  | {
      type: "alterColumn";
      tableName: string;
      columnName: string;
      oldColumn: ColumnSnapshot;
      newColumn: ColumnSnapshot;
    };

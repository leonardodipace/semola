import type { Dialect } from "../types.js";

export type SemolaConfig = {
  orm: {
    schema: string;
    migrations?: {
      dir?: string;
      transactional?: boolean;
    };
    introspect?: {
      output?: string;
      url?: string;
      dialect?: Dialect;
    };
  };
};

export type ResolvedSemolaConfig = {
  cwd: string;
  configPath: string;
  orm: {
    schema: string;
    migrations: {
      dir: string;
      transactional: boolean;
    };
    introspect: {
      output: string;
      url: string | null;
      dialect: Dialect | null;
    };
  };
};

export type ColumnSnapshot = {
  key: string;
  sqlName: string;
  kind: "uuid" | "string" | "number" | "boolean" | "date" | "json" | "jsonb";
  isSqlArray?: boolean;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  defaultKind?: "value" | "fn" | null;
  defaultValue?: unknown;
  referencesTable: string | null;
  referencesColumn: string | null;
  onDeleteAction: "CASCADE" | "RESTRICT" | "SET NULL" | null;
};

export type TableSnapshot = {
  key: string;
  tableName: string;
  columns: Record<string, ColumnSnapshot>;
};

export type SchemaSnapshot = {
  dialect: Dialect;
  tables: Record<string, TableSnapshot>;
};

export type MigrationOperation =
  | {
      kind: "create-table";
      table: TableSnapshot;
    }
  | {
      kind: "drop-table";
      table: TableSnapshot;
    }
  | {
      kind: "add-column";
      tableName: string;
      column: ColumnSnapshot;
    }
  | {
      kind: "drop-column";
      tableName: string;
      column: ColumnSnapshot;
    }
  | {
      kind: "rebuild-table";
      fromTable: TableSnapshot;
      toTable: TableSnapshot;
    };

export type MigrationInfo = {
  id: string;
  name: string;
  directoryName: string;
  directoryPath: string;
  upPath: string;
  downPath: string;
  snapshotPath: string;
};

export type ApplyMigrationsInput = {
  cwd?: string;
};

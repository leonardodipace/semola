import type { Column } from "../column/types.js";
import type { Adapter } from "../dialect/types.js";
import type { IndexSnapshot } from "../indexes/types.js";
import type { Table } from "../table/types.js";

export type ColumnSnapshot = {
  name: string;
  type: Column["type"];
  sqlType?: "uuid";
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  dbDefault?: string;
  enumValues?: string[];
  references?: {
    table: string;
    column: string;
  };
};

export type TableSnapshot = {
  name: string;
  columns: Record<string, ColumnSnapshot>;
  indexes: Record<string, IndexSnapshot>;
};

export type SchemaSnapshot = {
  tables: Record<string, TableSnapshot>;
};

export type MigrationOp =
  | { kind: "createTable"; table: TableSnapshot }
  | { kind: "dropTable"; table: TableSnapshot }
  | { kind: "addColumn"; table: string; column: ColumnSnapshot }
  | { kind: "dropColumn"; table: string; column: ColumnSnapshot }
  | {
      kind: "alterColumn";
      table: string;
      from: ColumnSnapshot;
      to: ColumnSnapshot;
    }
  | {
      kind: "recreateTable";
      from: TableSnapshot;
      to: TableSnapshot;
    }
  | { kind: "dropForeignKey"; table: string; column: ColumnSnapshot }
  | { kind: "addForeignKey"; table: string; column: ColumnSnapshot }
  | { kind: "dropPrimaryKey"; table: string }
  | { kind: "addPrimaryKey"; table: string; columns: string[] }
  | {
      kind: "renameTable";
      from: string;
      to: string;
      columns: ColumnSnapshot[];
    }
  | {
      kind: "renameColumn";
      table: string;
      from: string;
      to: string;
      column: ColumnSnapshot;
    }
  | { kind: "createIndex"; index: IndexSnapshot }
  | { kind: "dropIndex"; index: IndexSnapshot };

export type RenameQuestion =
  | {
      kind: "table";
      created: string;
      dropped: string[];
    }
  | {
      kind: "column";
      table: string;
      created: string;
      dropped: string[];
    };

export type RenameHandler = (
  question: RenameQuestion,
) => string | undefined | Promise<string | undefined>;

export type OrmConfig = {
  adapter: Adapter;
  url: string;
  tables: Record<string, Table>;
};

export type LoadedConfig = {
  migrationsDir: string;
  orm: OrmConfig;
};

export type MigrationRenderHelpers = {
  sqlTypeFor: (column: ColumnSnapshot) => string;
  formatDefault: (value: string) => string;
  enumCheckSql: (column: ColumnSnapshot) => string | undefined;
};

export type MigrationDialectSpec = {
  name: Adapter;
  sqlTypes: Record<ColumnSnapshot["type"], string>;
  uuidType: string;
  formatPlaceholder: (index: number) => string;
  formatDefault: (value: string) => string;
  deferCircularForeignKeys: boolean;
  sqlTypeFor?: (column: ColumnSnapshot) => string | undefined;
  normalizeOps?: (
    from: SchemaSnapshot,
    to: SchemaSnapshot,
    ops: MigrationOp[],
  ) => MigrationOp[];
  renderAlterColumn?: (
    table: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
    helpers: MigrationRenderHelpers,
  ) => string;
  renderRenameTable?: (
    op: Extract<MigrationOp, { kind: "renameTable" }>,
  ) => string;
  renderRenameColumn?: (
    op: Extract<MigrationOp, { kind: "renameColumn" }>,
  ) => string;
  prepareConnection?: (sql: Bun.SQL) => Promise<void>;
  assertForeignKeys?: (sql: Bun.SQL) => Promise<void>;
  lockMigrations?: (sql: Bun.SQL) => Promise<void>;
  beginMigration?: <T>(
    sql: Bun.SQL,
    fn: (tx: Bun.SQL) => Promise<T>,
  ) => Promise<T>;
};

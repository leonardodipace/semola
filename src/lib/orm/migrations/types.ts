import type { Column } from "../column/types.js";
import type { Adapter } from "../dialect/types.js";
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
  | { kind: "renameTable"; from: string; to: string }
  | { kind: "renameColumn"; table: string; from: string; to: string };

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

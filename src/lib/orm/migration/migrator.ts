import { mkdir } from "node:fs/promises";
import type { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
import { SchemaBuilder } from "./builder.js";
import { loadMigration, scanMigrationFiles } from "./files.js";
import { generateMigrationSource, writeMigrationSource } from "./generator.js";
import { introspectSchema } from "./introspect.js";
import {
  ensureMigrationsTable,
  getAppliedMigrations,
  recordMigration,
  removeMigration,
} from "./state.js";
import type {
  MigrationCreateOptions,
  MigrationStatus,
  TableDiffOperation,
} from "./types.js";

const toError = (value: unknown) => {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
};

const slugify = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
};

const timestamp = () => {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

type MigrationRuntimeOptions = {
  orm: Orm<Record<string, Table>>;
  migrationsDir?: string;
  migrationTable?: string;
};

const getRuntimeContext = (options: MigrationRuntimeOptions) => {
  return {
    orm: options.orm,
    migrationsDir: options.migrationsDir ?? `${process.cwd()}/migrations`,
    migrationTable: options.migrationTable ?? "semola_migrations",
  };
};

const runInTransaction = async (
  orm: Orm<Record<string, Table>>,
  run: () => Promise<void>,
) => {
  await orm.sql.unsafe("BEGIN");
  try {
    await run();
    await orm.sql.unsafe("COMMIT");
  } catch (error) {
    await orm.sql.unsafe("ROLLBACK");
    throw error;
  }
};

export const createMigration = async (
  options: MigrationRuntimeOptions & {
    name: string;
    tables: Record<string, Table>;
  },
) => {
  const runtime = getRuntimeContext(options);

  try {
    await mkdir(runtime.migrationsDir, { recursive: true });

    const up: TableDiffOperation[] = [];
    const down: TableDiffOperation[] = [];

    const tableEntries = Object.values(options.tables);
    const tableNames = tableEntries.map((table) => table.sqlName);
    const currentSchema = await introspectSchema(runtime.orm, tableNames);

    for (const table of tableEntries) {
      const existingColumns = currentSchema.get(table.sqlName);

      if (!existingColumns || existingColumns.size === 0) {
        up.push({ type: "createTable", table });
        down.unshift({ type: "dropTable", tableName: table.sqlName });
        continue;
      }

      for (const column of Object.values(table.columns)) {
        if (existingColumns.has(column.sqlName)) {
          continue;
        }

        up.push({
          type: "addColumn",
          tableName: table.sqlName,
          column,
        });

        down.unshift({
          type: "dropColumn",
          tableName: table.sqlName,
          columnName: column.sqlName,
        });
      }
    }

    const safeName = slugify(options.name);
    if (safeName.length === 0) {
      return [new Error("Migration name cannot be empty"), null] as const;
    }

    const version = timestamp();
    const filePath = `${runtime.migrationsDir}/${version}_${safeName}.ts`;
    const source = generateMigrationSource(up, down);
    await writeMigrationSource(filePath, source);

    return [null, filePath] as const;
  } catch (error) {
    return [toError(error), null] as const;
  }
};

export const applyMigrations = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  try {
    await ensureMigrationsTable(runtime.orm, runtime.migrationTable);
    const files = await scanMigrationFiles(runtime.migrationsDir);
    const applied = await getAppliedMigrations(
      runtime.orm,
      runtime.migrationTable,
    );
    const appliedVersions = new Set(applied.map((item) => item.version));
    const pending = files.filter((file) => !appliedVersions.has(file.version));
    const result: string[] = [];

    for (const file of pending) {
      const migration = await loadMigration(file);
      const schema = new SchemaBuilder(
        runtime.orm,
        runtime.orm.getDialectName(),
      );

      await runInTransaction(runtime.orm, async () => {
        await migration.up(schema);
        await recordMigration(
          runtime.orm,
          runtime.migrationTable,
          migration.version,
          migration.name,
        );
      });

      result.push(migration.version);
    }

    return [null, result] as const;
  } catch (error) {
    return [toError(error), null] as const;
  }
};

export const rollbackMigration = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  try {
    await ensureMigrationsTable(runtime.orm, runtime.migrationTable);
    const files = await scanMigrationFiles(runtime.migrationsDir);
    const applied = await getAppliedMigrations(
      runtime.orm,
      runtime.migrationTable,
    );

    if (applied.length === 0) {
      return [null, null] as const;
    }

    const latestApplied = applied[applied.length - 1];
    if (!latestApplied) {
      return [null, null] as const;
    }

    const file = files.find((entry) => entry.version === latestApplied.version);

    if (!file) {
      return [
        new Error(
          `Missing migration file for version ${latestApplied.version}`,
        ),
        null,
      ] as const;
    }

    const migration = await loadMigration(file);
    const schema = new SchemaBuilder(runtime.orm, runtime.orm.getDialectName());

    await runInTransaction(runtime.orm, async () => {
      await migration.down(schema);
      await removeMigration(
        runtime.orm,
        runtime.migrationTable,
        migration.version,
      );
    });

    return [null, migration.version] as const;
  } catch (error) {
    return [toError(error), null] as const;
  }
};

export const getMigrationStatus = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  try {
    await ensureMigrationsTable(runtime.orm, runtime.migrationTable);
    const files = await scanMigrationFiles(runtime.migrationsDir);
    const applied = await getAppliedMigrations(
      runtime.orm,
      runtime.migrationTable,
    );
    const appliedMap = new Map(
      applied.map((item) => [item.version, item.appliedAt] as const),
    );

    const statuses: MigrationStatus[] = files.map((file) => {
      const appliedAt = appliedMap.get(file.version) ?? null;
      return {
        version: file.version,
        name: file.name,
        applied: appliedAt !== null,
        appliedAt,
      };
    });

    return [null, statuses] as const;
  } catch (error) {
    return [toError(error), null] as const;
  }
};

export type { MigrationCreateOptions, MigrationRuntimeOptions };

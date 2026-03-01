import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { err, mightThrow, ok } from "../../errors/index.js";
import { loadConfig } from "./config.js";
import { diffSnapshots } from "./diff.js";
import { buildSchemaSnapshot, loadOrmFromSchema } from "./discover.js";
import {
  ensureMigrationsDirectory,
  listMigrations,
  nowMigrationId,
  relativeFromCwd,
  toMigrationName,
  uniqueMigrationDirectoryPath,
} from "./files.js";
import { buildDownSql, buildUpSql } from "./sql.js";
import type { SchemaSnapshot } from "./types.js";

function emptySnapshot(dialect: "postgres" | "mysql" | "sqlite") {
  const snapshot: SchemaSnapshot = {
    dialect,
    tables: {},
  };
  return snapshot;
}

async function loadPreviousSnapshot(
  migrationsDir: string,
  dialect: SchemaSnapshot["dialect"],
) {
  const migrations = await listMigrations(migrationsDir);
  const last = migrations[migrations.length - 1];

  if (!last) {
    return emptySnapshot(dialect);
  }

  const exists = await Bun.file(last.snapshotPath).exists();

  if (!exists) {
    return emptySnapshot(dialect);
  }

  const content = await Bun.file(last.snapshotPath).text();
  const parsed = JSON.parse(content) as SchemaSnapshot;

  if (!parsed.dialect) {
    return emptySnapshot(dialect);
  }

  return parsed;
}

export async function createMigration(input: { name: string; cwd?: string }) {
  const cwd = input.cwd ?? process.cwd();

  const [configErr, config] = await loadConfig(cwd);

  if (configErr) return err(configErr.type, configErr.message);

  const [ormErr, orm] = await loadOrmFromSchema(config.orm.schema);

  if (ormErr) return err(ormErr.type, ormErr.message);

  const currentSnapshot = buildSchemaSnapshot(orm);
  const previousSnapshot = await loadPreviousSnapshot(
    config.orm.migrations.dir,
    currentSnapshot.dialect,
  );
  const operations = diffSnapshots(previousSnapshot, currentSnapshot);

  if (operations.length === 0) {
    return ok({
      created: false as const,
      message: "No schema changes detected; migration not created",
      operationsCount: 0,
    });
  }

  const [ensureErr] = await mightThrow(
    ensureMigrationsDirectory(config.orm.migrations.dir),
  );

  if (ensureErr) {
    return err(
      "MigrationError",
      `Could not create migrations directory: ${ensureErr instanceof Error ? ensureErr.message : String(ensureErr)}`,
    );
  }

  const baseId = nowMigrationId();
  const migrationName = toMigrationName(input.name);

  const [uniqueDirErr, uniqueDir] = await mightThrow(
    uniqueMigrationDirectoryPath(
      config.orm.migrations.dir,
      baseId,
      migrationName,
    ),
  );

  if (uniqueDirErr) {
    return err(
      "MigrationError",
      `Could not generate migration path: ${uniqueDirErr instanceof Error ? uniqueDirErr.message : String(uniqueDirErr)}`,
    );
  }

  if (!uniqueDir) {
    return err("MigrationError", "Could not generate migration path");
  }

  const { migrationId, migrationDir } = uniqueDir;

  const [mkdirErr] = await mightThrow(mkdir(migrationDir, { recursive: true }));

  if (mkdirErr) {
    return err(
      "MigrationError",
      `Could not create migration directory: ${mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)}`,
    );
  }

  const upSql = buildUpSql(currentSnapshot.dialect, operations);
  const downSql = buildDownSql(currentSnapshot.dialect, operations);

  const upPath = join(migrationDir, "up.sql");
  const downPath = join(migrationDir, "down.sql");
  const snapshotPath = join(migrationDir, "snapshot.json");

  const [writeErr] = await mightThrow(
    Promise.all([
      Bun.write(upPath, upSql),
      Bun.write(downPath, downSql),
      Bun.write(snapshotPath, `${JSON.stringify(currentSnapshot, null, 2)}\n`),
    ]),
  );

  if (writeErr) {
    return err(
      "MigrationError",
      `Could not write migration files: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
    );
  }

  return ok({
    created: true as const,
    migrationId,
    migrationName,
    operationsCount: operations.length,
    upPath,
    downPath,
    upPathRelative: relativeFromCwd(cwd, upPath),
    downPathRelative: relativeFromCwd(cwd, downPath),
    configPathRelative: relativeFromCwd(cwd, config.configPath),
    schemaPathRelative: relativeFromCwd(cwd, config.orm.schema),
  });
}

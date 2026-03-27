import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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

function parseSnapshot(content: string, dialect: SchemaSnapshot["dialect"]) {
  try {
    const parsed = JSON.parse(content);

    if (typeof parsed !== "object") {
      return emptySnapshot(dialect);
    }

    if (parsed === null) {
      return emptySnapshot(dialect);
    }

    if (
      parsed.dialect !== "postgres" &&
      parsed.dialect !== "mysql" &&
      parsed.dialect !== "sqlite"
    ) {
      return emptySnapshot(dialect);
    }

    if (typeof parsed.tables !== "object") {
      return emptySnapshot(dialect);
    }

    if (parsed.tables === null) {
      return emptySnapshot(dialect);
    }

    return {
      dialect: parsed.dialect,
      tables: parsed.tables,
    };
  } catch {
    return emptySnapshot(dialect);
  }
}

async function loadPreviousSnapshot(
  migrationsDir: string,
  dialect: SchemaSnapshot["dialect"],
) {
  const list = await listMigrations(migrationsDir);
  const last = list[list.length - 1];

  if (!last) {
    return emptySnapshot(dialect);
  }

  const exists = await Bun.file(last.snapshotPath).exists();

  if (!exists) {
    return emptySnapshot(dialect);
  }

  const content = await Bun.file(last.snapshotPath).text();
  return parseSnapshot(content, dialect);
}

export async function createMigration(input: { name: string; cwd?: string }) {
  const cwd = input.cwd ?? process.cwd();

  const config = await loadConfig(cwd);
  const orm = await loadOrmFromSchema(config.orm.schema);

  const currentSnapshot = buildSchemaSnapshot(orm);
  const previousSnapshot = await loadPreviousSnapshot(
    config.orm.migrations.dir,
    currentSnapshot.dialect,
  );
  const operations = diffSnapshots(previousSnapshot, currentSnapshot);

  if (operations.length === 0) {
    return {
      created: false as const,
      message: "No schema changes detected; migration not created",
      operationsCount: 0,
    };
  }

  await ensureMigrationsDirectory(config.orm.migrations.dir);

  const baseId = nowMigrationId();
  const migrationName = toMigrationName(input.name);

  const uniqueDir = await uniqueMigrationDirectoryPath(
    config.orm.migrations.dir,
    baseId,
    migrationName,
  );

  const { migrationId, migrationDir } = uniqueDir;

  await mkdir(migrationDir, { recursive: true });

  const upSql = buildUpSql(currentSnapshot.dialect, operations);
  const downSql = buildDownSql(currentSnapshot.dialect, operations);

  const upPath = join(migrationDir, "up.sql");
  const downPath = join(migrationDir, "down.sql");
  const snapshotPath = join(migrationDir, "snapshot.json");

  await Promise.all([
    Bun.write(upPath, upSql),
    Bun.write(downPath, downSql),
    Bun.write(snapshotPath, `${JSON.stringify(currentSnapshot, null, 2)}\n`),
  ]);

  return {
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
  };
}

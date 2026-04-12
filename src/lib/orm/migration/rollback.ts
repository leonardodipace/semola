import { SQL } from "bun";
import { loadConfig } from "./config.js";
import { loadOrmFromSchema } from "./discover.js";
import { listMigrations, relativeFromCwd } from "./files.js";
import { runMigrationSql } from "./runner.js";
import {
  ensureMigrationStateTable,
  readLatestAppliedMigration,
  unmarkAppliedMigration,
} from "./state-table.js";

export async function rollbackMigration(input?: { cwd?: string }) {
  const cwd = input?.cwd ?? process.cwd();

  const config = await loadConfig(cwd);
  const orm = await loadOrmFromSchema(config.orm.schema);

  const sql = new SQL(orm.options.url);

  try {
    await ensureMigrationStateTable(sql, orm.dialect);

    const migrations = await listMigrations(config.orm.migrations.dir);
    const last = await readLatestAppliedMigration(sql);

    if (!last) {
      return {
        rolledBack: false as const,
        message: "No applied migrations found",
        configPathRelative: relativeFromCwd(cwd, config.configPath),
      };
    }

    const migration = migrations.find(
      (item) => item.directoryName === last.directoryName,
    );

    if (!migration) {
      throw new Error(
        `Could not find migration directory for ${last.directoryName}`,
      );
    }

    const sqlText = await Bun.file(migration.downPath).text();

    await runMigrationSql(sql, sqlText, config.orm.migrations.transactional);
    await unmarkAppliedMigration(sql, {
      directoryName: migration.directoryName,
    });

    return {
      rolledBack: true as const,
      migrationId: migration.id,
      migrationName: migration.name,
      configPathRelative: relativeFromCwd(cwd, config.configPath),
    };
  } finally {
    await sql.close();
  }
}

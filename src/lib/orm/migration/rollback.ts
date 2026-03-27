import type { SQL as SqlType, TransactionSQL } from "bun";
import { SQL } from "bun";
import { loadConfig } from "./config.js";
import { loadOrmFromSchema } from "./discover.js";
import { listMigrations, relativeFromCwd, splitStatements } from "./files.js";
import { readMigrationState, unmarkAppliedMigration } from "./state-file.js";

async function runStatements(
  runner: SqlType | TransactionSQL,
  sqlText: string,
) {
  const statements = splitStatements(sqlText);

  for (const statement of statements) {
    await runner`${runner.unsafe(statement)}`;
  }
}

async function runRollbackSql(
  sql: SQL,
  sqlText: string,
  transactional: boolean,
) {
  if (transactional) {
    await sql.begin(async (tx) => {
      await runStatements(tx, sqlText);
    });
    return;
  }

  await runStatements(sql, sqlText);
}

async function readState(stateFilePath: string) {
  const state = await readMigrationState(stateFilePath);

  if (!state) {
    return { applied: [] };
  }

  return state;
}

export async function rollbackMigration(input: { cwd?: string }) {
  const cwd = input.cwd ?? process.cwd();

  const config = await loadConfig(cwd);
  const orm = await loadOrmFromSchema(config.orm.schema);

  const sql = new SQL(orm.options.url);

  try {
    const migrations = await listMigrations(config.orm.migrations.dir);
    const state = await readState(config.orm.migrations.stateFile);

    const last = state.applied[state.applied.length - 1];

    if (!last) {
      return {
        rolledBack: false as const,
        message: "No applied migrations found",
        configPathRelative: relativeFromCwd(cwd, config.configPath),
      };
    }

    const migration = migrations.find((item) => item.id === last.id);

    if (!migration) {
      throw new Error(`Could not find migration directory for id ${last.id}`);
    }

    const sqlText = await Bun.file(migration.downPath).text();

    await runRollbackSql(sql, sqlText, config.orm.migrations.transactional);
    await unmarkAppliedMigration(config.orm.migrations.stateFile, migration.id);

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

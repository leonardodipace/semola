import type { SQL as SqlType, TransactionSQL } from "bun";
import { SQL } from "bun";
import { loadConfig } from "./config.js";
import { loadOrmFromSchema } from "./discover.js";
import { listMigrations, relativeFromCwd, splitStatements } from "./files.js";
import { markAppliedMigration, readMigrationState } from "./state-file.js";
import type { ApplyMigrationsInput } from "./types.js";

async function runStatements(
  runner: SqlType | TransactionSQL,
  sqlText: string,
) {
  const statements = splitStatements(sqlText);

  for (const statement of statements) {
    await runner`${runner.unsafe(statement)}`;
  }
}

function hasExplicitTransaction(sqlText: string) {
  const statements = splitStatements(sqlText);

  for (const statement of statements) {
    const normalized = statement.trim().toUpperCase();

    if (normalized === "BEGIN") {
      return true;
    }

    if (normalized === "BEGIN TRANSACTION") {
      return true;
    }

    if (normalized === "COMMIT") {
      return true;
    }

    if (normalized === "ROLLBACK") {
      return true;
    }
  }

  return false;
}

async function readState(stateFilePath: string) {
  const state = await readMigrationState(stateFilePath);

  if (!state) {
    return { applied: [] };
  }

  return state;
}

async function runMigrationSql(
  sql: SQL,
  sqlText: string,
  transactional: boolean,
) {
  if (transactional && !hasExplicitTransaction(sqlText)) {
    await sql.begin(async (tx) => {
      await runStatements(tx, sqlText);
    });
    return;
  }

  await runStatements(sql, sqlText);
}

export async function applyMigrations(input?: ApplyMigrationsInput) {
  const cwd = input?.cwd ?? process.cwd();

  const config = await loadConfig(cwd);
  const orm = await loadOrmFromSchema(config.orm.schema);

  const sql = new SQL(orm.options.url);

  try {
    const migrations = await listMigrations(config.orm.migrations.dir);
    const state = await readState(config.orm.migrations.stateFile);

    const appliedIds = new Set(state.applied.map((item) => item.id));
    const pending = migrations.filter(
      (migration) => !appliedIds.has(migration.id),
    );

    if (pending.length === 0) {
      return {
        applied: 0,
        pending: 0,
        total: migrations.length,
        configPathRelative: relativeFromCwd(cwd, config.configPath),
        stateFileRelative: relativeFromCwd(
          cwd,
          config.orm.migrations.stateFile,
        ),
      };
    }

    for (const migration of pending) {
      const sqlText = await Bun.file(migration.upPath).text();

      await runMigrationSql(sql, sqlText, config.orm.migrations.transactional);

      await markAppliedMigration(config.orm.migrations.stateFile, migration.id);
    }

    return {
      applied: pending.length,
      pending: 0,
      total: migrations.length,
      appliedIds: pending.map((item) => item.id),
      configPathRelative: relativeFromCwd(cwd, config.configPath),
      stateFileRelative: relativeFromCwd(cwd, config.orm.migrations.stateFile),
    };
  } finally {
    await sql.close();
  }
}

import type { SQL as SqlType, TransactionSQL } from "bun";
import { SQL } from "bun";
import { loadConfig } from "./config.js";
import { loadOrmFromSchema } from "./discover.js";
import { listMigrations, relativeFromCwd, splitStatements } from "./files.js";
import {
  ensureMigrationStateTable,
  getMigrationTableName,
  listAppliedMigrations,
  markAppliedMigration,
} from "./state-table.js";
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

    if (normalized.startsWith("BEGIN ")) {
      return true;
    }

    if (normalized === "START TRANSACTION") {
      return true;
    }

    if (normalized.startsWith("COMMIT")) {
      return true;
    }

    if (normalized.startsWith("ROLLBACK")) {
      return true;
    }
  }

  return false;
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
    await ensureMigrationStateTable(sql);

    const migrations = await listMigrations(config.orm.migrations.dir);
    const applied = await listAppliedMigrations(sql);

    const appliedIds = new Set(applied.map((item) => item.directoryName));

    const pending = migrations.filter(
      (migration) => !appliedIds.has(migration.directoryName),
    );

    if (pending.length === 0) {
      return {
        applied: 0,
        pending: 0,
        total: migrations.length,
        trackerTable: getMigrationTableName(),
        configPathRelative: relativeFromCwd(cwd, config.configPath),
      };
    }

    for (const migration of pending) {
      const sqlText = await Bun.file(migration.upPath).text();

      await runMigrationSql(sql, sqlText, config.orm.migrations.transactional);

      await markAppliedMigration(sql, {
        id: migration.id,
        name: migration.name,
        directoryName: migration.directoryName,
      });
    }

    return {
      applied: pending.length,
      pending: 0,
      total: migrations.length,
      appliedIds: pending.map((item) => item.id),
      trackerTable: getMigrationTableName(),
      configPathRelative: relativeFromCwd(cwd, config.configPath),
    };
  } finally {
    await sql.close();
  }
}

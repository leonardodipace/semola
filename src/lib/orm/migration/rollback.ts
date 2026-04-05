import type { SQL as SqlType, TransactionSQL } from "bun";
import { SQL } from "bun";
import { loadConfig } from "./config.js";
import { loadOrmFromSchema } from "./discover.js";
import { listMigrations, relativeFromCwd, splitStatements } from "./files.js";
import {
  ensureMigrationStateTable,
  readLatestAppliedMigration,
  unmarkAppliedMigration,
} from "./state-table.js";

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

async function runRollbackSql(
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

export async function rollbackMigration(input: { cwd?: string }) {
  const cwd = input.cwd ?? process.cwd();

  const config = await loadConfig(cwd);
  const orm = await loadOrmFromSchema(config.orm.schema);

  const sql = new SQL(orm.options.url);

  try {
    await ensureMigrationStateTable(sql);

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

    await runRollbackSql(sql, sqlText, config.orm.migrations.transactional);
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

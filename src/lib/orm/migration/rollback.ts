import type { SQL as SqlType, TransactionSQL } from "bun";
import { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
import { loadConfig } from "./config.js";
import { loadOrmFromSchema } from "./discover.js";
import { listMigrations, relativeFromCwd } from "./files.js";
import { readMigrationState, unmarkAppliedMigration } from "./state-file.js";

function splitStatements(sqlText: string) {
  const chunks = sqlText
    .split(";")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  return chunks;
}

async function runStatements(
  runner: SqlType | TransactionSQL,
  sqlText: string,
) {
  const statements = splitStatements(sqlText);

  for (const statement of statements) {
    await runner`${runner.unsafe(statement)}`;
  }
}

export async function rollbackMigration(input: { cwd?: string }) {
  const cwd = input.cwd ?? process.cwd();

  const [configErr, config] = await loadConfig(cwd);

  if (configErr) return err(configErr.type, configErr.message);

  const [ormErr, orm] = await loadOrmFromSchema(config.orm.schema);

  if (ormErr) return err(ormErr.type, ormErr.message);

  const sql = new SQL(orm.options.url);

  const migrations = await listMigrations(config.orm.migrations.dir);
  const state = await readMigrationState(config.orm.migrations.stateFile);
  const last = state.applied[state.applied.length - 1];

  if (!last) {
    return ok({
      rolledBack: false as const,
      message: "No applied migrations found",
      configPathRelative: relativeFromCwd(cwd, config.configPath),
    });
  }

  const migration = migrations.find((item) => item.id === last.id);

  if (!migration) {
    return err(
      "MigrationError",
      `Could not find migration directory for id ${last.id}`,
    );
  }

  const [readErr, downSql] = await mightThrow(
    Bun.file(migration.downPath).text(),
  );

  if (readErr) {
    return err(
      "MigrationError",
      `Could not read migration file: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
    );
  }

  const sqlText = downSql ?? "";

  if (config.orm.migrations.transactional) {
    const [txErr] = await mightThrow(
      sql.begin(async (tx) => {
        await runStatements(tx, sqlText);
      }),
    );

    if (txErr) {
      return err(
        "MigrationError",
        `Rollback of ${migration.id} failed: ${txErr instanceof Error ? txErr.message : String(txErr)}`,
      );
    }
  } else {
    const [stmtErr] = await mightThrow(runStatements(sql, sqlText));

    if (stmtErr) {
      return err(
        "MigrationError",
        `Rollback of ${migration.id} failed: ${stmtErr instanceof Error ? stmtErr.message : String(stmtErr)}`,
      );
    }
  }

  const [unmarkErr] = await mightThrow(
    unmarkAppliedMigration(config.orm.migrations.stateFile, migration.id),
  );

  if (unmarkErr) {
    return err(
      "MigrationError",
      `Could not update migration state: ${unmarkErr instanceof Error ? unmarkErr.message : String(unmarkErr)}`,
    );
  }

  return ok({
    rolledBack: true as const,
    migrationId: migration.id,
    migrationName: migration.name,
    configPathRelative: relativeFromCwd(cwd, config.configPath),
  });
}

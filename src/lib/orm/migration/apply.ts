import type { SQL as SqlType, TransactionSQL } from "bun";
import { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
import { loadConfig } from "./config.js";
import { loadOrmFromSchema } from "./discover.js";
import { listMigrations, relativeFromCwd } from "./files.js";
import { markAppliedMigration, readMigrationState } from "./state-file.js";

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

export async function applyMigrations(input: { cwd?: string }) {
  const cwd = input.cwd ?? process.cwd();

  const [configErr, config] = await loadConfig(cwd);

  if (configErr) return err(configErr.type, configErr.message);

  const [ormErr, orm] = await loadOrmFromSchema(config.orm.schema);

  if (ormErr) return err(ormErr.type, ormErr.message);

  const sql = new SQL(orm.options.url);

  const migrations = await listMigrations(config.orm.migrations.dir);
  const state = await readMigrationState(config.orm.migrations.stateFile);
  const appliedIds = new Set(state.applied.map((item) => item.id));
  const pending = migrations.filter(
    (migration) => !appliedIds.has(migration.id),
  );

  if (pending.length === 0) {
    return ok({
      applied: 0,
      pending: 0,
      total: migrations.length,
      configPathRelative: relativeFromCwd(cwd, config.configPath),
      stateFileRelative: relativeFromCwd(cwd, config.orm.migrations.stateFile),
    });
  }

  for (const migration of pending) {
    const [readErr, upSql] = await mightThrow(
      Bun.file(migration.upPath).text(),
    );

    if (readErr) {
      return err(
        "MigrationError",
        `Could not read migration ${migration.id}: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
      );
    }

    const sqlText = upSql ?? "";

    if (config.orm.migrations.transactional) {
      const [txErr] = await mightThrow(
        sql.begin(async (tx) => {
          await runStatements(tx, sqlText);
        }),
      );

      if (txErr) {
        return err(
          "MigrationError",
          `Migration ${migration.id} failed: ${txErr instanceof Error ? txErr.message : String(txErr)}`,
        );
      }
    } else {
      const [stmtErr] = await mightThrow(runStatements(sql, sqlText));

      if (stmtErr) {
        return err(
          "MigrationError",
          `Migration ${migration.id} failed: ${stmtErr instanceof Error ? stmtErr.message : String(stmtErr)}`,
        );
      }
    }

    const [markErr] = await mightThrow(
      markAppliedMigration(config.orm.migrations.stateFile, migration.id),
    );

    if (markErr) {
      return err(
        "MigrationError",
        `Could not update migration state: ${markErr instanceof Error ? markErr.message : String(markErr)}`,
      );
    }
  }

  return ok({
    applied: pending.length,
    pending: 0,
    total: migrations.length,
    appliedIds: pending.map((item) => item.id),
    configPathRelative: relativeFromCwd(cwd, config.configPath),
    stateFileRelative: relativeFromCwd(cwd, config.orm.migrations.stateFile),
  });
}

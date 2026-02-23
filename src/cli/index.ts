#!/usr/bin/env bun

import { resolve } from "node:path";
import { Orm } from "../lib/orm/core/index.js";
import {
  applyMigrations,
  createMigration,
  rollbackMigration,
} from "../lib/orm/migration/migrator.js";
import type { Table } from "../lib/orm/table/index.js";
import { loadSchemaTables, loadSemolaConfig } from "./config.js";

const printLine = (value: string) => {
  process.stdout.write(`${value}\n`);
};

const printError = (value: string) => {
  process.stderr.write(`${value}\n`);
  process.exitCode = 1;
};

const printUsage = () => {
  printLine("Usage:");
  printLine("  bunx semola orm migrations create <name>");
  printLine("  bunx semola orm migrations apply");
  printLine("  bunx semola orm migrations rollback");
};

const withOrm = async (
  orm: Orm<Record<string, Table>>,
  fn: () => Promise<void>,
) => {
  await fn();
  await orm.close();
};

const run = async () => {
  const args = process.argv.slice(2);

  if (args.length < 3 || args[0] !== "orm" || args[1] !== "migrations") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const command = args[2];
  const cwd = process.cwd();

  const [configError, config] = await loadSemolaConfig(cwd);
  if (configError) {
    printError(configError.message);
    return;
  }

  const [schemaError, tables] = await loadSchemaTables(config.orm.schema.path);
  if (schemaError) {
    printError(schemaError.message);
    return;
  }

  const orm = new Orm({
    url: config.orm.url,
    dialect: config.orm.dialect,
    tables,
  });

  const migrationOptions = {
    orm,
    migrationsDir: resolve(cwd, "migrations"),
    migrationTable: "semola_migrations",
  };

  await withOrm(orm, async () => {
    if (command === "create") {
      const name = args[3];

      if (!name) {
        printError("Missing migration name");
        return;
      }

      const [createError, filePath] = await createMigration({
        ...migrationOptions,
        name,
        tables,
      });

      if (createError) {
        printError(createError.message);
        return;
      }

      printLine(`Created migration: ${filePath}`);
      return;
    }

    if (command === "apply") {
      const [error, applied] = await applyMigrations(migrationOptions);

      if (error) {
        printError(error.message);
        return;
      }

      if (applied?.length === 0) {
        printLine("No pending migrations");
        return;
      }

      printLine(`Applied migrations: ${applied?.join(", ")}`);
      return;
    }

    if (command === "rollback") {
      const [rollbackError, rolledBack] =
        await rollbackMigration(migrationOptions);

      if (rollbackError) {
        printError(rollbackError.message);
        return;
      }

      if (!rolledBack) {
        printLine("No applied migrations to rollback");
        return;
      }

      printLine(`Rolled back migration: ${rolledBack}`);
      return;
    }

    printError(`Unknown command: ${command}`);
    printUsage();
  });
};

void run();

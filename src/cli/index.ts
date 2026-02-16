#!/usr/bin/env bun

import { resolve } from "node:path";
import { Orm } from "../lib/orm/core/index.js";
import {
  applyMigrations,
  createMigration,
  rollbackMigration,
} from "../lib/orm/migration/migrator.js";
import { loadSchemaTables, loadSemolaConfig } from "./config.js";

const printLine = (value: string) => {
  process.stdout.write(`${value}\n`);
};

const printError = (value: string) => {
  process.stderr.write(`${value}\n`);
};

const printUsage = () => {
  printLine("Usage:");
  printLine("  bunx semola orm migrations create <name>");
  printLine("  bunx semola orm migrations apply");
  printLine("  bunx semola orm migrations rollback");
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
  if (configError || !config) {
    printError(configError?.message ?? "Failed to load semola config");
    process.exitCode = 1;
    return;
  }

  const [schemaError, tables] = await loadSchemaTables(
    config.schema.path,
    config.schema.exportName,
  );

  if (schemaError || !tables) {
    printError(schemaError?.message ?? "Failed to load schema tables");
    process.exitCode = 1;
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

  try {
    if (command === "create") {
      const name = args[3];

      if (!name) {
        printError("Missing migration name");
        process.exitCode = 1;
        return;
      }

      const [error, filePath] = await createMigration({
        ...migrationOptions,
        name,
        tables,
      });
      if (error || !filePath) {
        printError(error?.message ?? "Failed to create migration");
        process.exitCode = 1;
        return;
      }

      printLine(`Created migration: ${filePath}`);
      return;
    }

    if (command === "apply") {
      const [error, applied] = await applyMigrations(migrationOptions);

      if (error || !applied) {
        printError(error?.message ?? "Failed to apply migrations");
        process.exitCode = 1;
        return;
      }

      if (applied.length === 0) {
        printLine("No pending migrations");
        return;
      }

      printLine(`Applied migrations: ${applied.join(", ")}`);
      return;
    }

    if (command === "rollback") {
      const [error, rolledBack] = await rollbackMigration(migrationOptions);

      if (error) {
        printError(error.message);
        process.exitCode = 1;
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
    process.exitCode = 1;
  } finally {
    orm.close();
  }
};

void run();

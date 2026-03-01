#!/usr/bin/env bun

import {
  applyMigrations,
  createMigration,
  rollbackMigration,
} from "../lib/orm/migration/index.js";

function usage() {
  return [
    "Usage:",
    "  semola orm migrations create <name>",
    "  semola orm migrations apply",
    "  semola orm migrations rollback",
  ].join("\n");
}

type CliIo = {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
};

const defaultIo: CliIo = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  cwd: process.cwd(),
};

export async function runSemolaCli(
  argv = process.argv.slice(2),
  io = defaultIo,
) {
  if (argv[0] !== "orm" || argv[1] !== "migrations") {
    io.error(usage());
    return 1;
  }

  const action = argv[2];
  if (action === "create") {
    const migrationName = argv[3];
    if (!migrationName) {
      io.error("Missing migration name");
      io.error(usage());
      return 1;
    }

    const [error, result] = await createMigration({
      name: migrationName,
      cwd: io.cwd,
    });
    if (error) {
      io.error(error.message);
      return 1;
    }

    if (!result.created) {
      io.log(result.message);
      return 0;
    }

    io.log(`Loaded config from ${result.configPathRelative}`);
    io.log(`Loaded schema from ${result.schemaPathRelative}`);
    io.log(`Diff detected ${result.operationsCount} operations`);
    io.log(`Created ${result.upPathRelative}`);
    io.log(`Created ${result.downPathRelative}`);
    return 0;
  }

  if (action === "apply") {
    const [error, result] = await applyMigrations({ cwd: io.cwd });
    if (error) {
      io.error(error.message);
      return 1;
    }

    io.log(`Loaded config from ${result.configPathRelative}`);
    if (result.pending === 0) {
      io.log(
        `No pending migrations (${result.total} total, state: ${result.stateFileRelative})`,
      );
      return 0;
    }
    io.log(
      `Applied ${result.applied}/${result.pending} migrations successfully`,
    );
    return 0;
  }

  if (action === "rollback") {
    const [error, result] = await rollbackMigration({ cwd: io.cwd });
    if (error) {
      io.error(error.message);
      return 1;
    }

    io.log(`Loaded config from ${result.configPathRelative}`);
    if (!result.rolledBack) {
      io.log(result.message);
      return 0;
    }
    io.log(`Rolled back ${result.migrationId}_${result.migrationName}`);
    return 0;
  }

  io.error(usage());
  return 1;
}

if (import.meta.main) {
  runSemolaCli().then((code) => {
    process.exit(code);
  });
}

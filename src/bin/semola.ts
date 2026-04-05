#!/usr/bin/env bun

import { runIntrospect } from "../lib/orm/introspect/run.js";
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
    "  semola orm introspect [--url <url>] [--dialect <dialect>] [--output <path>] [--schema <name>]",
  ].join("\n");
}

type CliIo = {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
};

type IntrospectArgs = {
  output?: string;
  schema?: string;
  url?: string;
  dialect?: string;
};

const defaultIo: CliIo = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  cwd: process.cwd(),
};

function parseIntrospectArgs(argv: string[]): IntrospectArgs {
  const args: IntrospectArgs = {};

  for (let index = 2; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!value) {
      continue;
    }

    if (flag === "--output") {
      args.output = value;
      index++;
      continue;
    }

    if (flag === "--schema") {
      args.schema = value;
      index++;
      continue;
    }

    if (flag === "--url") {
      args.url = value;
      index++;
      continue;
    }

    if (flag === "--dialect") {
      args.dialect = value;
      index++;
    }
  }

  return args;
}

async function runIntrospectCommand(argv: string[], io: CliIo) {
  const args = parseIntrospectArgs(argv);
  const data = await runIntrospect({
    cwd: io.cwd,
    output: args.output,
    schema: args.schema,
    url: args.url,
    dialect: args.dialect,
  });

  if (data.configPathRelative) {
    io.log(`Loaded config from ${data.configPathRelative}`);
  }

  io.log(
    `Introspected ${data.tableCount} tables -> ${data.outputPathRelative}`,
  );
}

function readMigrationName(argv: string[]) {
  const migrationName = argv[3];

  if (!migrationName) {
    throw new Error("Missing migration name");
  }

  return migrationName;
}

async function runCreateMigrationCommand(argv: string[], io: CliIo) {
  const result = await createMigration({
    name: readMigrationName(argv),
    cwd: io.cwd,
  });

  if (!result.created) {
    io.log(result.message);
    return;
  }

  io.log(`Loaded config from ${result.configPathRelative}`);
  io.log(`Loaded schema from ${result.schemaPathRelative}`);
  io.log(`Diff detected ${result.operationsCount} operations`);
  io.log(`Created ${result.upPathRelative}`);
  io.log(`Created ${result.downPathRelative}`);
}

async function runApplyMigrationsCommand(io: CliIo) {
  const result = await applyMigrations({ cwd: io.cwd });

  io.log(`Loaded config from ${result.configPathRelative}`);

  if (result.applied === 0) {
    io.log(
      `No pending migrations (${result.total} total, tracker: ${result.trackerTable})`,
    );
    return;
  }

  io.log(`Applied ${result.applied}/${result.total} migrations successfully`);
}

async function runRollbackCommand(io: CliIo) {
  const result = await rollbackMigration({ cwd: io.cwd });

  io.log(`Loaded config from ${result.configPathRelative}`);

  if (!result.rolledBack) {
    io.log(result.message);
    return;
  }

  io.log(`Rolled back ${result.migrationId}_${result.migrationName}`);
}

async function runMigrationsCommand(argv: string[], io: CliIo) {
  const action = argv[2];

  if (action === "create") {
    await runCreateMigrationCommand(argv, io);
    return;
  }

  if (action === "apply") {
    await runApplyMigrationsCommand(io);
    return;
  }

  if (action === "rollback") {
    await runRollbackCommand(io);
    return;
  }

  throw new Error(usage());
}

export async function runSemolaCli(
  argv = process.argv.slice(2),
  io = defaultIo,
) {
  try {
    if (argv[0] !== "orm") {
      throw new Error(usage());
    }

    if (argv[1] === "introspect") {
      await runIntrospectCommand(argv, io);
      return 0;
    }

    if (argv[1] === "migrations") {
      await runMigrationsCommand(argv, io);
      return 0;
    }

    throw new Error(usage());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    io.error(message);

    if (message === "Missing migration name") {
      io.error(usage());
    }

    return 1;
  }
}

if (import.meta.main) {
  runSemolaCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

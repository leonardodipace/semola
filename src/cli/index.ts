#!/usr/bin/env bun
import packageJson from "../../package.json" with { type: "json" };
import { CLI } from "../lib/cli/index.js";
import { MigrationError } from "../lib/orm/errors.js";
import {
  applyMigrations,
  createMigration,
  loadConfig,
  rollbackMigration,
} from "../lib/orm/migrations/index.js";

const stringArg = {
  "~standard": {
    version: 1 as const,
    vendor: "semola",
    validate: (value: unknown) => {
      if (typeof value !== "string") {
        return { issues: [{ message: "expected string" }] };
      }

      if (value.length === 0) {
        return { issues: [{ message: "expected non-empty string" }] };
      }

      return { value };
    },
  },
};

const run = async () => {
  const program = new CLI({
    name: "semola",
    description: "Semola CLI",
    version: packageJson.version,
  });

  const migrations = program.command("orm").command("migrations");

  migrations
    .command("create", {
      description: "Generate a migration from schema changes",
    })
    .argument("name", { schema: stringArg })
    .action(async (args) => {
      const config = await loadConfig();
      const folder = await createMigration({
        name: args.name as string,
        config,
      });

      console.log(`Created migration ${folder}`);
    });

  migrations
    .command("apply", { description: "Apply pending migrations" })
    .action(async () => {
      const config = await loadConfig();
      const applied = await applyMigrations(config);

      if (applied.length === 0) {
        console.log("No pending migrations");
        return;
      }

      for (const name of applied) {
        console.log(`Applied ${name}`);
      }
    });

  migrations
    .command("rollback", {
      description: "Rollback the last applied migration",
    })
    .action(async () => {
      const config = await loadConfig();
      const name = await rollbackMigration(config);

      console.log(`Rolled back ${name}`);
    });

  try {
    await program.parse();
  } catch (error) {
    if (error instanceof MigrationError) {
      console.error(error.message);
      process.exit(1);
    }

    throw error;
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

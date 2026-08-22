#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { CLI } from "../lib/cli/index.js";
import { mightThrow } from "../lib/errors/index.js";
import { MigrationError } from "../lib/orm/errors.js";
import type { RenameQuestion } from "../lib/orm/migrations/index.js";
import {
  applyMigrations,
  createMigration,
  loadConfig,
  rollbackMigration,
} from "../lib/orm/migrations/index.js";
import type { SelectChoice } from "../lib/prompts/index.js";
import { select } from "../lib/prompts/index.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const stringArg = {
  "~standard": {
    version: 1 as const,
    vendor: "semola",
    types: {
      input: "" as string,
      output: "" as string,
    },
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

const CREATE = "";

const promptRename = async (question: RenameQuestion) => {
  if (question.dropped.length === 0) return;

  let entity = "column";
  let created = "";
  let fromPrefix = "";

  if (question.kind === "table") {
    entity = "table";
    created = question.created;
  } else {
    created = `${question.table}.${question.created}`;
    fromPrefix = `${question.table}.`;
  }

  const choices: SelectChoice<string>[] = [];

  for (const name of question.dropped) {
    choices.push({
      value: name,
      label: `~ ${fromPrefix}${name} › ${created}`,
    });
  }

  choices.push({
    value: CREATE,
    label: `+ ${created} › create ${entity}`,
  });

  const selected = await select({
    message: `Is ${created} ${entity} renamed or created from scratch?`,
    choices,
  });

  if (selected === CREATE) return;

  return selected;
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
        name: args.name,
        config,
        onRename: promptRename,
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

  const [error] = await mightThrow(program.parse());

  if (!error) return;

  if (error instanceof MigrationError) {
    console.error(error.message);
    process.exit(1);
  }

  throw error;
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

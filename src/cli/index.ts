#!/usr/bin/env bun
import packageJson from "../../package.json" with { type: "json" };
import { CLI } from "../lib/cli/index.js";
import { mightThrow } from "../lib/errors/index.js";
import { MigrationError } from "../lib/orm/errors.js";
import {
  applyMigrations,
  createMigration,
  loadConfig,
  rollbackMigration,
} from "../lib/orm/migrations/runner.js";
import type { RenameQuestion } from "../lib/orm/migrations/types.js";
import { PromptEnvironmentError } from "../lib/prompts/errors.js";
import type { SelectChoice } from "../lib/prompts/index.js";
import { confirm, select } from "../lib/prompts/index.js";

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

const booleanFlag = {
  "~standard": {
    version: 1 as const,
    vendor: "semola",
    types: {
      input: false as boolean,
      output: false as boolean,
    },
    validate: (value: unknown) => {
      if (value === undefined) {
        return { value: false };
      }

      if (value === true) {
        return { value: true };
      }

      if (value === false) {
        return { value: false };
      }

      return { issues: [{ message: "expected boolean" }] };
    },
  },
};

const isInteractive = () => {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
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

const promptDestructive = async () => {
  if (!isInteractive()) {
    throw new MigrationError(
      "Destructive schema changes require --allow-destructive when not running in a TTY",
    );
  }

  return confirm({
    message: "This migration drops tables or columns. Continue?",
    defaultValue: false,
  });
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
    .option("allow-destructive", { schema: booleanFlag })
    .action(async (args, options) => {
      const config = await loadConfig();
      const allowDestructive = Boolean(options["allow-destructive"]);
      const interactive = isInteractive();
      const input: Parameters<typeof createMigration>[0] = {
        name: args.name,
        config,
        allowDestructive,
      };

      if (interactive) {
        input.onRename = promptRename;
      }

      if (!allowDestructive) {
        if (interactive) {
          input.onDestructive = promptDestructive;
        }
      }

      const folder = await createMigration(input);

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

  if (error instanceof PromptEnvironmentError) {
    console.error(error.message);
    process.exit(1);
  }

  throw error;
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

---
title: CLI
description: Typed command-line programs with Standard Schema args
---

Build CLIs with nested commands, validated arguments, and options. Schemas are Standard Schema (Zod, Valibot, …).

## Import

```typescript
import { CLI } from "semola/cli";
import { z } from "zod";
```

## Quick start

This defines `split`, validates its positional string and boolean flag, runs its action, then parses the process arguments.

```typescript
const program = new CLI({
  name: "semola",
  version: "1.0.0",
  description: "Example CLI",
});

program
  .command("split")
  .argument("str", { schema: z.string() })
  .option("first", {
    schema: z.boolean().default(false),
    aliases: ["f"],
  })
  .action((args, options) => {
    const parts = args.str.split(" ");
    console.log(options.first ? parts[0] : parts);
  });

await program.parse();
```

`parse()` reads `process.argv.slice(2)` by default; pass an array for tests. Empty argv prints help and exits with code 1.

## Nested commands

Each `command()` call descends one level, producing `app orm migrate`; the final action receives validated options.

```typescript
program
  .command("orm")
  .command("migrate")
  .option("dryRun", { schema: z.boolean().default(false) })
  .action(async (_args, options) => {
    if (options.dryRun) {
      console.log("would migrate");
      return;
    }

    await migrate();
  });
```

## Arguments and options

Chain on a command:

- `argument(name, { schema })` - positional, validated
- `option(name, { schema, aliases? })` - flags, validated
- `command(name, { description? })` - nest further
- `action(handler)` - run when this command is selected; returns the root `CLI`

## Examples

### Parse explicit arguments

Passing an array to `parse()` runs the matching command without reading `process.argv`.

```typescript
await program.parse(["split", "hello world", "--first"]);
```

### Add a nested command

The two `command()` calls create `db migrate`; `-d` resolves through the option alias before the action runs.

```typescript
const cli = new CLI({ name: "app", version: "1.0.0" });

cli
  .command("db")
  .command("migrate")
  .option("dryRun", {
    schema: z.boolean().default(false),
    aliases: ["d"],
  })
  .action(async (_args, options) => {
    await runMigrations({ dryRun: options.dryRun });
  });

await cli.parse(["db", "migrate", "-d"]);
```

### Add a required option

The string schema makes `--name` required and gives the action a typed value.

```typescript
program
  .command("greet")
  .option("name", { schema: z.string() })
  .action((_args, options) => {
    console.log(`Hello, ${options.name}`);
  });
```

### Add a positional argument

`argument()` validates a positional token before passing it to the action.

```typescript
program
  .command("echo")
  .argument("message", { schema: z.string() })
  .action((args) => {
    console.log(args.message);
  });
```

### Run an action

`action()` attaches the handler that runs after all selected command arguments and options validate.

```typescript
program.command("version").action(() => {
  console.log("1.0.0");
});
```

## Reference

### `CLI` constructor

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | required | Program name |
| `description` | - | Shown in help |
| `version` | `"0.0.0"` | Version string |

### Methods

| Method | Meaning |
| --- | --- |
| `command(name, options?)` | Add / nest a command |
| `parse(argv?)` | Parse argv and run the matching action |

## Errors

Exported from `semola/cli`: `CliConfigurationError`, `CliValidationError`, `MissingArgumentError`, `UnknownCommandError`.

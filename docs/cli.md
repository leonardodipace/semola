---
title: CLI
description: Typed command-line programs with Standard Schema args
---

Build CLIs with nested commands, validated arguments, and options. Schemas are Standard Schema (Zod, Valibot, …).

```typescript
import { CLI } from "semola/cli";
import { z } from "zod";
```

## A small program

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

`parse()` reads `process.argv` by default; pass an array for tests.

## Nested commands

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

## Errors

Exported from `semola/cli`: `CliConfigurationError`, `CliValidationError`, `MissingArgumentError`, `UnknownCommandError`.

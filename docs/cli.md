# CLI

Non-interactive CLI builder with argv parsing and Standard Schema validation. Complements `semola/prompts` for interactive TTY prompts.

## Import

```typescript
import { CLI } from "semola/cli";
```

## API

| Export                 | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `CLI`                  | Program builder with `.command()`, `.parse()`    |
| `CliValidationError`   | Schema validation failed for an argument/option  |
| `UnknownCommandError`  | Subcommand name not registered                   |
| `MissingArgumentError` | Required positional argument not provided        |

Use any Standard Schema library (Zod, Valibot, ArkType, etc.) for argument and option schemas.

## Examples

### Split string

```typescript
import { CLI } from "semola/cli";
import { z } from "zod";

const program = new CLI({
  name: "string-util",
  description: "String utilities",
  version: "0.6.7",
});

program
  .command("split")
  .argument("str", { schema: z.string().min(1) })
  .option("separator", { schema: z.string().min(1).default(",") })
  .option("first", { schema: z.boolean().default(false) })
  .action((args, options) => {
    const parts = args.str.split(options.separator);

    if (options.first) {
      console.log(parts[0]);
      return;
    }

    console.log(parts.join("\n"));
  });

await program.parse();
// string-util split "Hello, world!" --first --separator ","
```

### Publish package

```typescript
program
  .command("publish")
  .argument("pkg", { schema: z.string().min(1) })
  .option("tag", { schema: z.string().min(1), aliases: ["t"] })
  .action((args, options) => {
    console.log(`Publishing ${args.pkg} with tag ${options.tag}`);
  });

await program.parse(["publish", "my-package", "-t", "v1.0.0"]);
```

## Argv parsing

- Long options: `--name`, `--name=value`, `--name value`
- Short aliases: `-t value`, `-tv1.0.0` (single-character aliases only)
- Boolean flags: bare `--first` or `-f` sets the option to `true`
- Positional arguments: tokens not starting with `-`
- `--` sentinel: everything after `--` is treated as positional
- Unknown options throw `CliValidationError`

Each argument and option is validated individually with its schema, so per-field `.default()` works when a value is missing.

## Global flags

Before the subcommand name:

- `-h`, `--help` - print usage and command list
- `-v`, `--version` - print program version

On validation failure or unknown command, the program writes to stderr and exits with code `1`.

## Error classes

| Error                  | When                                        |
| ---------------------- | ------------------------------------------- |
| `CliValidationError`   | Schema validation failed                    |
| `UnknownCommandError`  | Subcommand not found                        |
| `MissingArgumentError` | Too few positional arguments for a command  |

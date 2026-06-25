import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Cli } from "./cli.js";
import type { ArgumentConfig, InferOutput, OptionConfig } from "./types.js";

export class Command<
  TArgs extends Record<string, unknown> = Record<string, never>,
  TOptions extends Record<string, unknown> = Record<string, never>,
> {
  public readonly arguments: ArgumentConfig[] = [];
  public readonly options: OptionConfig[] = [];
  public readonly commands = new Map<
    string,
    Command<Record<string, unknown>, Record<string, unknown>>
  >();
  public handler?: (
    args: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => void | Promise<void>;

  public constructor(
    private readonly cli: Cli,
    public readonly name: string,
  ) {}

  public command(name: string) {
    if (this.commands.has(name)) {
      throw new Error(`Command "${name}" already exists`);
    }

    const command = new Command(this.cli, name);

    this.commands.set(name, command);

    return command;
  }

  public argument<K extends string, S extends StandardSchemaV1>(
    name: K,
    config: { schema: S },
  ) {
    for (const existing of this.arguments) {
      if (existing.name === name) {
        throw new Error(`Argument "${name}" already exists`);
      }
    }

    this.arguments.push({ name, schema: config.schema });

    return this as Command<TArgs & Record<K, InferOutput<S>>, TOptions>;
  }

  public option<K extends string, S extends StandardSchemaV1>(
    name: K,
    config: { schema: S; aliases?: string[] },
  ) {
    for (const existing of this.options) {
      if (existing.name === name) {
        throw new Error(`Option "${name}" already exists`);
      }
    }

    const aliases = config.aliases ?? [];

    for (const alias of aliases) {
      for (const existing of this.options) {
        if (existing.name === alias) {
          throw new Error(
            `Option alias "${alias}" conflicts with option "${existing.name}"`,
          );
        }

        if (existing.aliases?.includes(alias)) {
          throw new Error(`Option alias "${alias}" already exists`);
        }
      }
    }

    for (const existing of this.options) {
      if (existing.aliases?.includes(name)) {
        throw new Error(
          `Option "${name}" conflicts with alias of option "${existing.name}"`,
        );
      }
    }

    this.options.push({
      name,
      schema: config.schema,
      aliases: config.aliases,
    });

    return this as Command<TArgs, TOptions & Record<K, InferOutput<S>>>;
  }

  public action(
    handler: (args: TArgs, options: TOptions) => void | Promise<void>,
  ) {
    this.handler = handler as (
      args: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => void | Promise<void>;

    return this.cli;
  }
}

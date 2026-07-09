import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Cli } from "./cli.js";
import type {
  ArgumentConfig,
  HandlerFnType,
  InferOutput,
  OptionConfig,
} from "./types.js";

export class Command<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  public readonly arguments: ArgumentConfig[] = [];
  public readonly options: OptionConfig[] = [];
  public readonly commands = new Map<string, Command>();
  public handler?: HandlerFnType;

  public constructor(
    private readonly cli: Cli,
    public readonly name: string,
    public readonly parent?: Command,
    public readonly description?: string,
  ) {}

  public command(name: string, config?: { description?: string }) {
    if (this.commands.has(name)) {
      throw new Error(`Command "${name}" already exists`);
    }

    const command = new Command(this.cli, name, this, config?.description);

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
    const aliases = config.aliases ?? [];

    for (const existing of this.options) {
      if (existing.name === name) {
        throw new Error(`Option "${name}" already exists`);
      }

      if (existing.aliases?.includes(name)) {
        throw new Error(
          `Option "${name}" conflicts with alias of option "${existing.name}"`,
        );
      }

      for (const alias of aliases) {
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
    this.handler = handler as HandlerFnType;
    return this.cli;
  }
}

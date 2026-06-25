import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Cli } from "./cli.js";
import {
  commandHelpOptions,
  formatArgumentPlaceholders,
  formatCommandListLines,
  formatOptionUsageEntry,
  formatUsageEntries,
  getSchemaDescription,
  printDescription,
} from "./help.js";
import type {
  ArgumentConfig,
  CLIConfig,
  InferOutput,
  OptionConfig,
} from "./types.js";

export type AnyCommand = Command<
  Record<string, unknown>,
  Record<string, unknown>
>;

export class Command<
  TArgs extends Record<string, unknown> = Record<string, never>,
  TOptions extends Record<string, unknown> = Record<string, never>,
> {
  public readonly arguments: ArgumentConfig[] = [];
  public readonly options: OptionConfig[] = [];
  public readonly commands = new Map<string, AnyCommand>();
  public handler?: (
    args: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => void | Promise<void>;

  public constructor(
    private readonly cli: Cli,
    public readonly name: string,
    public readonly parent?: AnyCommand,
  ) {}

  public get path() {
    const names: string[] = [];
    let node: AnyCommand | undefined = this as AnyCommand;

    while (node?.parent) {
      names.unshift(node.name);
      node = node.parent;
    }

    return names;
  }

  public command(name: string) {
    if (this.commands.has(name)) {
      throw new Error(`Command "${name}" already exists`);
    }

    const command = new Command(this.cli, name, this as AnyCommand);

    this.commands.set(name, command);

    return command;
  }

  public resolve(tokens: string[]) {
    let current: AnyCommand = this as AnyCommand;
    let index = 0;

    while (index < tokens.length) {
      const token = tokens[index];

      if (!token) break;
      if (token.startsWith("-")) break;

      const next = current.commands.get(token);

      if (!next) break;

      current = next;
      index++;
    }

    if (index === 0) {
      return { command: undefined, rest: tokens.slice(index) };
    }

    return { command: current, rest: tokens.slice(index) };
  }

  public printHelp(config: CLIConfig) {
    const argNames = formatArgumentPlaceholders(this.arguments);
    const commandPath = this.path.join(" ");
    const usageParts = [config.name, commandPath, argNames, "[options]"];
    const usage = usageParts.filter((part) => part.length > 0).join(" ");

    console.log(`Usage: ${usage}\n`);

    printDescription(config.description);

    if (this.arguments.length > 0) {
      console.log("Arguments:");

      const argumentEntries = this.arguments.map((argument) => ({
        label: argument.name,
        description: getSchemaDescription(argument.schema),
      }));

      for (const line of formatUsageEntries(argumentEntries)) {
        console.log(line);
      }

      console.log("");
    }

    if (this.commands.size > 0) {
      console.log("Commands:");

      for (const line of formatCommandListLines(this.commands)) {
        console.log(line);
      }

      console.log("");
    }

    console.log("Options:");

    const commandOptionEntries = this.options.map(formatOptionUsageEntry);
    const optionEntries = [...commandOptionEntries, ...commandHelpOptions];

    for (const line of formatUsageEntries(optionEntries)) {
      console.log(line);
    }
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
    this.handler = handler as (
      args: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => void | Promise<void>;

    return this.cli;
  }
}

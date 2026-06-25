import { Command } from "./command.js";
import {
  CliValidationError,
  MissingArgumentError,
  UnknownCommandError,
} from "./errors.js";
import {
  commandHelpOptions,
  formatArgumentPlaceholders,
  formatOptionUsageEntry,
  formatUsageEntries,
  getSchemaDescription,
  globalOptions,
} from "./help.js";
import { parseArgv } from "./parser.js";
import type { CLIConfig } from "./types.js";
import { validateArguments, validateOptions } from "./validate.js";

export class Cli {
  private readonly config: CLIConfig;
  private readonly commands = new Map<
    string,
    Command<Record<string, unknown>, Record<string, unknown>>
  >();

  public constructor(config: CLIConfig) {
    this.config = config;
  }

  public command(name: string) {
    if (this.commands.has(name)) {
      throw new Error(`Command "${name}" already exists`);
    }

    const command = new Command(this, name);

    this.commands.set(name, command);

    return command;
  }

  public async parse(argv?: string[]) {
    const tokens = argv ?? process.argv.slice(2);

    if (tokens.length === 0) {
      this.printHelp();
      process.exit(1);
    }

    const [first] = tokens;

    if (!first) {
      this.printHelp();
      process.exit(1);
    }

    if (first === "--help" || first === "-h") {
      this.printHelp();
      return;
    }

    if (first === "--version" || first === "-v") {
      this.printVersion();
      return;
    }

    const { command, path, rest } = this.resolveCommand(tokens);
    const [firstPath] = path;
    const [firstRest] = rest;

    if (!command) {
      const attempted = firstPath ?? first;
      this.handleCliError(
        new UnknownCommandError(`Unknown command: ${attempted}`),
      );
    }

    if (firstRest === "--help" || firstRest === "-h") {
      this.printCommandHelp(command, path);
      return;
    }

    const handler = command.handler;

    if (!handler) {
      if (command.commands.size > 0) {
        this.printCommandHelp(command, path);
        return;
      }

      throw new Error(`Command "${path.join(" ")}" has no action handler`);
    }

    try {
      const parsed = parseArgv(rest, command.options);
      const args = await validateArguments(
        command.arguments,
        parsed.positional,
      );
      const options = await validateOptions(command.options, parsed.options);

      await handler(args, options);
    } catch (error) {
      this.handleCliError(error);
    }
  }

  private printVersion() {
    const version = this.config.version ?? "0.0.0";

    console.log(version);
  }

  private printHelp() {
    console.log(`Usage: ${this.config.name} <command> [options]\n`);

    this.printDescription();

    console.log("Commands:");

    for (const [name, command] of this.commands) {
      const argNames = formatArgumentPlaceholders(command.arguments);
      const parts = [name, argNames].filter((part) => part.length > 0);

      console.log(`  ${parts.join(" ")}`);
    }

    console.log("");
    this.printGlobalOptions();
  }

  private printCommandHelp(
    command: Command<Record<string, unknown>, Record<string, unknown>>,
    path: string[],
  ) {
    const argNames = formatArgumentPlaceholders(command.arguments);
    const commandPath = path.join(" ");
    const usageParts = [this.config.name, commandPath, argNames, "[options]"];
    const usage = usageParts.filter((part) => part.length > 0).join(" ");

    console.log(`Usage: ${usage}\n`);

    this.printDescription();

    if (command.arguments.length > 0) {
      console.log("Arguments:");

      const argumentEntries = command.arguments.map((argument) => ({
        label: argument.name,
        description: getSchemaDescription(argument.schema),
      }));

      for (const line of formatUsageEntries(argumentEntries)) {
        console.log(line);
      }

      console.log("");
    }

    if (command.commands.size > 0) {
      console.log("Commands:");

      for (const [name, child] of command.commands) {
        const childArgNames = formatArgumentPlaceholders(child.arguments);
        const parts = [name, childArgNames].filter((part) => part.length > 0);

        console.log(`  ${parts.join(" ")}`);
      }

      console.log("");
    }

    console.log("Options:");

    const commandOptionEntries = command.options.map(formatOptionUsageEntry);
    const optionEntries = [...commandOptionEntries, ...commandHelpOptions];

    for (const line of formatUsageEntries(optionEntries)) {
      console.log(line);
    }
  }

  private printDescription() {
    if (!this.config.description) {
      return;
    }

    console.log(`${this.config.description}\n`);
  }

  private printGlobalOptions() {
    console.log("Options:");

    for (const line of formatUsageEntries(globalOptions)) {
      console.log(line);
    }
  }

  private handleCliError(error: unknown): never {
    if (error instanceof CliValidationError) {
      console.error(error.message);
      process.exit(1);
    }

    if (error instanceof UnknownCommandError) {
      console.error(error.message);
      process.exit(1);
    }

    if (error instanceof MissingArgumentError) {
      console.error(error.message);
      process.exit(1);
    }

    throw error;
  }

  private resolveCommand(tokens: string[]) {
    let current:
      | Command<Record<string, unknown>, Record<string, unknown>>
      | undefined;
    let commands = this.commands;
    const path: string[] = [];
    let index = 0;

    while (index < tokens.length) {
      const token = tokens[index];

      if (!token) {
        break;
      }

      if (token.startsWith("-")) {
        break;
      }

      const next = commands.get(token);

      if (!next) {
        if (current) {
          break;
        }

        return { command: undefined, path: [token], rest: tokens.slice(index) };
      }

      current = next;
      path.push(token);
      commands = next.commands;
      index++;
    }

    return { command: current, path, rest: tokens.slice(index) };
  }
}

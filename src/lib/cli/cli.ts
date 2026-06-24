import { Command } from "./command.js";
import {
  CliValidationError,
  MissingArgumentError,
  UnknownCommandError,
} from "./errors.js";
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

    const [first, ...rest] = tokens;

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

    const command = this.commands.get(first);

    if (!command) {
      this.handleCliError(new UnknownCommandError(`Unknown command: ${first}`));
    }

    if (rest[0] === "--help" || rest[0] === "-h") {
      this.printCommandHelp(command);
      return;
    }

    const handler = command.handler;

    if (!handler) {
      throw new Error(`Command "${first}" has no action handler`);
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

    if (this.config.description) {
      console.log(`${this.config.description}\n`);
    }

    console.log("Commands:");

    for (const [name, command] of this.commands) {
      const argNames = command.arguments
        .map((argument) => `<${argument.name}>`)
        .join(" ");
      const parts = [name, argNames].filter((part) => part.length > 0);

      console.log(`  ${parts.join(" ")}`);
    }

    console.log("\nOptions:");
    console.log("  -h, --help       Show help");
    console.log("  -v, --version    Show version");
  }

  private printCommandHelp(
    command: Command<Record<string, unknown>, Record<string, unknown>>,
  ) {
    const argNames = command.arguments
      .map((argument) => `<${argument.name}>`)
      .join(" ");
    const usageParts = [this.config.name, command.name, argNames, "[options]"];
    const usage = usageParts.filter((part) => part.length > 0).join(" ");

    console.log(`Usage: ${usage}\n`);

    if (this.config.description) {
      console.log(`${this.config.description}\n`);
    }

    if (command.arguments.length > 0) {
      console.log("Arguments:");

      for (const argument of command.arguments) {
        console.log(`  ${argument.name}`);
      }

      console.log("");
    }

    console.log("Options:");

    for (const option of command.options) {
      const flags = [
        ...(option.aliases ?? []).map((alias) => `-${alias}`),
        `--${option.name}`,
      ];

      console.log(`  ${flags.join(", ")}`);
    }

    console.log("  -h, --help       Show help");
    console.log("  -v, --version    Show version");
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
}

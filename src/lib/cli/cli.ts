import { Command } from "./command.js";
import { CliError, UnknownCommandError } from "./errors.js";
import {
  formatCommandListLines,
  formatUsageEntries,
  globalOptions,
  isHelpToken,
  isVersionToken,
  printDescription,
} from "./help.js";
import { parseArgv } from "./parser.js";
import type { CLIConfig } from "./types.js";
import { validateArguments, validateOptions } from "./validate.js";

export class Cli {
  private readonly config: CLIConfig;
  private readonly root = new Command(this, "");

  public constructor(config: CLIConfig) {
    this.config = config;
  }

  public command(name: string) {
    return this.root.command(name);
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

    if (isHelpToken(first)) {
      this.printHelp();
      return;
    }

    if (isVersionToken(first)) {
      this.printVersion();
      return;
    }

    const { command, rest } = this.root.resolve(tokens);
    const [firstRest] = rest;

    if (!command) {
      const attempted = firstRest ?? first;
      this.handleCliError(
        new UnknownCommandError(`Unknown command: ${attempted}`),
      );
    }

    if (isHelpToken(firstRest)) {
      command.printHelp(this.config);
      return;
    }

    const handler = command.handler;

    if (!handler) {
      if (command.commands.size > 0) {
        if (firstRest !== undefined) {
          this.handleCliError(
            new UnknownCommandError(`Unknown command: ${firstRest}`),
          );
        }

        command.printHelp(this.config);
        return;
      }

      throw new Error(
        `Command "${command.path.join(" ")}" has no action handler`,
      );
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

    printDescription(this.config.description);

    console.log("Commands:");

    for (const line of formatCommandListLines(this.root.commands)) {
      console.log(line);
    }

    console.log("");
    this.printGlobalOptions();
  }

  private printGlobalOptions() {
    console.log("Options:");

    for (const line of formatUsageEntries(globalOptions)) {
      console.log(line);
    }
  }

  private handleCliError(error: unknown): never {
    if (error instanceof CliError) {
      console.error(error.message);
      process.exit(1);
    }

    throw error;
  }
}

import { CommandHelper } from "./command.helper.js";
import { Command } from "./command.js";
import {
  CliConfigurationError,
  CliError,
  UnknownCommandError,
} from "./errors.js";
import {
  formatCommandListLines,
  formatUsageEntries,
  globalOptions,
  isHelpToken,
  isVersionToken,
  printDescription,
} from "./help.js";
import { parseArgv } from "./parser.js";
import { searchPossibleCommands } from "./search.command.js";
import type { CLIConfig } from "./types.js";
import { validateArguments, validateOptions } from "./validate.js";

export class Cli {
  private readonly config: CLIConfig;
  private readonly root = new Command(this, "");
  private readonly commandHelper = new CommandHelper();

  public constructor(config: CLIConfig) {
    this.config = config;
  }

  public command(name: string, config?: { description?: string }) {
    return this.root.command(name, config);
  }

  public async parse(argv?: string[]) {
    const tokens = argv ?? process.argv.slice(2);
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

    const { command, rest } = this.commandHelper.resolve(this.root, tokens);
    const [firstRest] = rest;

    if (!command) {
      const suggestionMessage = this.createSuggestion(first);
      this.handleCliError(
        new UnknownCommandError(
          this.formatUnknownCommandMessage(first, suggestionMessage),
        ),
      );
    }

    if (isHelpToken(firstRest)) {
      this.commandHelper.printHelp(command, this.config);
      return;
    }

    const handler = command.handler;

    if (!handler) {
      if (command.commands.size > 0) {
        if (firstRest !== undefined) {
          const suggestionMessage = this.createSuggestion(firstRest);
          this.handleCliError(
            new UnknownCommandError(
              this.formatUnknownCommandMessage(firstRest, suggestionMessage),
            ),
          );
        }

        this.commandHelper.printHelp(command, this.config);
        return;
      }

      const noHandlerCommand = this.commandHelper.path(command).join(" ");
      this.handleCliError(
        new CliConfigurationError(
          `Command "${noHandlerCommand}" has no action handler`,
        ),
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
      this.handleCliError(error as Error);
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
    console.log("Options:");

    for (const line of formatUsageEntries(globalOptions)) {
      console.log(line);
    }
  }

  private handleCliError(error: Error): never {
    if (error instanceof CliError) {
      console.error(error.message);
      process.exit(1);
    }

    throw error;
  }

  private createSuggestion(userCommand: string) {
    const commands = this.commandHelper.readCommands(this.root);
    const suggestions = searchPossibleCommands(commands, userCommand);

    if (suggestions.length === 0) return "";
    if (suggestions.length === 1) return `Did you mean ${suggestions[0]}?`;

    const header = "Did you mean \n";
    const message = suggestions.reduce((prev, curr, index) => {
      let acc = prev.concat(`  ${curr}`);

      if (index !== suggestions.length - 1) {
        acc = acc.concat("\n");
      }

      return acc;
    }, header);

    return message;
  }

  private formatUnknownCommandMessage(
    command: string,
    suggestionMessage: string,
  ) {
    if (suggestionMessage.length === 0) {
      return `Unknown command: ${command}`;
    }

    return `Unknown command: ${command}\n${suggestionMessage}`;
  }
}

import type { Command } from "./command.js";
import {
  commandHelpOptions,
  formatArgumentPlaceholders,
  formatCommandListLines,
  formatOptionUsageEntry,
  formatUsageEntries,
  getSchemaDescription,
  printDescription,
} from "./help.js";
import type { CLIConfig } from "./types.js";

export class CommandHelper {
  public path(command: Command) {
    const names: string[] = [];
    let node: Command | undefined = command;

    while (node?.parent) {
      names.unshift(node.name);
      node = node.parent;
    }

    return names;
  }

  public readCommands(command: Command) {
    return command.commands.keys().toArray();
  }

  public resolve(command: Command, tokens: string[]) {
    let current: Command = command;
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

  public printHelp(command: Command, config: CLIConfig) {
    const argNames = formatArgumentPlaceholders(command.arguments);
    const commandPath = this.path(command).join(" ");
    const usageParts = [config.name, commandPath, argNames, "[options]"];
    const usage = usageParts.filter((part) => part.length > 0).join(" ");

    console.log(`Usage: ${usage}\n`);

    printDescription(config.description);

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

      for (const line of formatCommandListLines(command.commands)) {
        console.log(line);
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
}

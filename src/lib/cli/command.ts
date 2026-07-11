import type { Cli } from "./cli.js";
import type { ArgumentConfig, HandlerFnType, OptionConfig } from "./types.js";

export class Command {
  public readonly arguments: ArgumentConfig[] = [];
  public readonly options: OptionConfig[] = [];
  public readonly commands = new Map<string, Command>();
  public handler?: HandlerFnType;

  public constructor(
    public readonly cli: Cli,
    public readonly name: string,
    public readonly parent?: Command,
    public readonly description?: string,
  ) {}

  public create(name: string, config?: { description?: string }) {
    if (this.commands.has(name)) {
      throw new Error(`Command "${name}" already exists`);
    }

    const command = new Command(this.cli, name, this, config?.description);
    this.commands.set(name, command);

    return command;
  }
}

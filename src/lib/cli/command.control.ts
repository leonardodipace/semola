import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Command } from "./command.js";
import type { HandlerFnType, InferOutput } from "./types.js";

export class CommandControl<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  private root: Command;

  public constructor(root: Command) {
    this.root = root;
  }

  public command(name: string, config?: { description?: string }) {
    const subCommand = this.root.create(name, config);
    return new CommandControl(subCommand);
  }

  public argument<K extends string, S extends StandardSchemaV1>(
    name: K,
    config: { schema: S },
  ) {
    for (const existing of this.root.arguments) {
      if (existing.name === name) {
        throw new Error(`Argument "${name}" already exists`);
      }
    }

    this.root.arguments.push({ name, schema: config.schema });

    return this as CommandControl<TArgs & Record<K, InferOutput<S>>, TOptions>;
  }

  public option<K extends string, S extends StandardSchemaV1>(
    name: K,
    config: { schema: S; aliases?: string[] },
  ) {
    const aliases = config.aliases ?? [];

    for (const existing of this.root.options) {
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

    this.root.options.push({
      name,
      schema: config.schema,
      aliases: config.aliases,
    });

    return this as CommandControl<TArgs, TOptions & Record<K, InferOutput<S>>>;
  }

  public action(
    handler: (args: TArgs, options: TOptions) => void | Promise<void>,
  ) {
    this.root.handler = handler as HandlerFnType;
    return this.root.cli;
  }
}

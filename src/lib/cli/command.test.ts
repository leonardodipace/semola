import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Cli as CLI } from "./cli.js";

const app = () => new CLI({ name: "app" });

const runCommand = () => app().command("run");

describe("Command", () => {
  test("supports fluent chaining and returns CLI from action", () => {
    const program = app();
    let called = false;

    const result = program
      .command("run")
      .argument("name", { schema: z.string() })
      .option("verbose", { schema: z.boolean().default(false) })
      .action(() => {
        called = true;
      });

    expect(result).toBe(program);
    expect(called).toBe(false);
  });

  test("rejects duplicate argument names", () => {
    expect(() => {
      runCommand()
        .argument("name", { schema: z.string() })
        .argument("name", { schema: z.string() });
    }).toThrow('Argument "name" already exists');
  });

  test("rejects duplicate option names", () => {
    expect(() => {
      runCommand()
        .option("verbose", { schema: z.boolean().default(false) })
        .option("verbose", { schema: z.boolean().default(true) });
    }).toThrow('Option "verbose" already exists');
  });

  test("rejects duplicate command names", () => {
    const program = app();

    program.command("run").action(() => {});

    expect(() => {
      program.command("run");
    }).toThrow('Command "run" already exists');
  });

  test("rejects duplicate nested command names", () => {
    const program = app();
    const orm = program.command("orm");

    orm.command("migrations");

    expect(() => {
      orm.command("migrations");
    }).toThrow('Command "migrations" already exists');
  });

  test("rejects duplicate option aliases", () => {
    expect(() => {
      runCommand()
        .option("tag", { schema: z.string(), aliases: ["t"] })
        .option("type", { schema: z.string(), aliases: ["t"] });
    }).toThrow('Option alias "t" already exists');
  });

  test("rejects option alias conflicting with option name", () => {
    expect(() => {
      runCommand()
        .option("verbose", { schema: z.boolean().default(false) })
        .option("other", { schema: z.string(), aliases: ["verbose"] });
    }).toThrow('Option alias "verbose" conflicts with option "verbose"');
  });
});

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Cli as CLI } from "./cli.js";

describe("Command", () => {
  test("supports fluent chaining and returns CLI from action", () => {
    const program = new CLI({ name: "app" });
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
    const program = new CLI({ name: "app" });

    expect(() => {
      program
        .command("run")
        .argument("name", { schema: z.string() })
        .argument("name", { schema: z.string() });
    }).toThrow('Argument "name" already exists');
  });

  test("rejects duplicate option names", () => {
    const program = new CLI({ name: "app" });

    expect(() => {
      program
        .command("run")
        .option("verbose", { schema: z.boolean().default(false) })
        .option("verbose", { schema: z.boolean().default(true) });
    }).toThrow('Option "verbose" already exists');
  });

  test("rejects duplicate command names", () => {
    const program = new CLI({ name: "app" });

    program.command("run").action(() => {});

    expect(() => {
      program.command("run");
    }).toThrow('Command "run" already exists');
  });
});

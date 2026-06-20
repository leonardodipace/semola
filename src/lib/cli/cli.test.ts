import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Cli as CLI } from "./cli.js";

class ProcessExitError extends Error {
  public readonly code: number;

  public constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

const withExitStub = async (run: () => Promise<void>) => {
  const originalExit = process.exit;
  let exitCode = -1;
  const stderr: string[] = [];
  const stdout: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;

  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };

  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };

  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new ProcessExitError(exitCode);
  }) as typeof process.exit;

  try {
    await run();
  } catch (error) {
    if (!(error instanceof ProcessExitError)) {
      throw error;
    }
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
  }

  return { exitCode, stderr, stdout };
};

describe("CLI", () => {
  test("dispatches split command with args and options", async () => {
    const program = new CLI({
      name: "string-util",
      description: "String utilities",
      version: "0.6.7",
    });

    let receivedArgs: Record<string, unknown> | undefined;
    let receivedOptions: Record<string, unknown> | undefined;

    program
      .command("split")
      .argument("str", { schema: z.string().min(1) })
      .option("separator", { schema: z.string().min(1).default(",") })
      .option("first", { schema: z.boolean().default(false) })
      .action((args, options) => {
        receivedArgs = args;
        receivedOptions = options;
      });

    await program.parse([
      "split",
      "Hello, world!",
      "--first",
      "--separator",
      ",",
    ]);

    expect(receivedArgs).toEqual({ str: "Hello, world!" });
    expect(receivedOptions).toEqual({ separator: ",", first: true });
  });

  test("dispatches publish command with short alias option", async () => {
    const program = new CLI({ name: "pkg-cli", version: "1.0.0" });

    let receivedArgs: Record<string, unknown> | undefined;
    let receivedOptions: Record<string, unknown> | undefined;

    program
      .command("publish")
      .argument("pkg", { schema: z.string().min(1) })
      .option("tag", { schema: z.string().min(1), aliases: ["t"] })
      .action((args, options) => {
        receivedArgs = args;
        receivedOptions = options;
      });

    await program.parse(["publish", "my-package", "-t", "v1.0.0"]);

    expect(receivedArgs).toEqual({ pkg: "my-package" });
    expect(receivedOptions).toEqual({ tag: "v1.0.0" });
  });

  test("prints help for --help", async () => {
    const program = new CLI({
      name: "string-util",
      description: "String utilities",
      version: "0.6.7",
    });

    program
      .command("split")
      .argument("str", { schema: z.string() })
      .option("first", { schema: z.boolean().default(false) })
      .action(() => {});

    const { stdout, exitCode } = await withExitStub(async () => {
      await program.parse(["--help"]);
    });

    expect(exitCode).toBe(-1);
    expect(stdout.join("\n")).toContain("Usage: string-util");
    expect(stdout.join("\n")).toContain("split");
    expect(stdout.join("\n")).toContain("--help");
  });

  test("prints version for --version", async () => {
    const program = new CLI({ name: "string-util", version: "0.6.7" });

    const { stdout } = await withExitStub(async () => {
      await program.parse(["--version"]);
    });

    expect(stdout).toEqual(["0.6.7"]);
  });

  test("exits with error on unknown command", async () => {
    const program = new CLI({ name: "string-util" });

    program
      .command("split")
      .argument("str", { schema: z.string() })
      .action(() => {});

    const { exitCode, stderr } = await withExitStub(async () => {
      await program.parse(["missing"]);
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Unknown command: missing");
  });

  test("exits with error on validation failure", async () => {
    const program = new CLI({ name: "string-util" });

    program
      .command("split")
      .argument("str", { schema: z.string().min(5) })
      .action(() => {});

    const { exitCode, stderr } = await withExitStub(async () => {
      await program.parse(["split", "hi"]);
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("str:");
  });
});

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

const runHelp = async (program: CLI, argv: string[]) => {
  const { stdout, exitCode } = await withExitStub(async () => {
    await program.parse(argv);
  });

  return { help: stdout.join("\n"), exitCode };
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

  test("dispatches nested command", async () => {
    const program = new CLI({ name: "semola-cli" });
    let called = false;

    program
      .command("orm")
      .command("migrations")
      .command("create")
      .action(() => {
        called = true;
      });

    await program.parse(["orm", "migrations", "create"]);

    expect(called).toBe(true);
  });

  test("prints help for --help", async () => {
    const program = new CLI({
      name: "string-util",
      description: "String utilities",
      version: "0.6.7",
    });

    program
      .command("split", { description: "Split input string" })
      .argument("str", { schema: z.string() })
      .option("first", { schema: z.boolean().default(false) })
      .action(() => {});

    const { help, exitCode } = await runHelp(program, ["--help"]);

    expect(exitCode).toBe(-1);
    expect(help).toContain("Usage: string-util");
    expect(help).toContain("split");
    expect(help).toContain("Split input string");
    expect(help).toContain("--help");
  });

  test("prints command help for split --help", async () => {
    const program = new CLI({
      name: "string-util",
      description: "String utilities",
    });

    program
      .command("split")
      .argument("str", { schema: z.string() })
      .option("separator", { schema: z.string().default(",") })
      .option("first", { schema: z.boolean().default(false) })
      .action(() => {});

    const { help, exitCode } = await runHelp(program, ["split", "--help"]);

    expect(exitCode).toBe(-1);
    expect(help).toContain("Usage: string-util split <str>");
    expect(help).toContain("String utilities");
    expect(help).toContain("Arguments:");
    expect(help).toContain("str");
    expect(help).toContain("--separator");
    expect(help).toContain("--first");
    expect(help).toContain("-h, --help");
    expect(help).not.toContain("-v, --version");
    expect(help).not.toContain("--first\n\n  -h");
  });

  test("prints nested command help", async () => {
    const program = new CLI({ name: "semola-cli", description: "Semola CLI" });

    program
      .command("orm")
      .command("migrations")
      .command("create")
      .action(() => {
        //
      });

    const { help, exitCode } = await runHelp(program, [
      "orm",
      "migrations",
      "--help",
    ]);

    expect(exitCode).toBe(-1);
    expect(help).toContain("Usage: semola-cli orm migrations [options]");
    expect(help).toContain("Commands:");
    expect(help).toContain("create");
  });

  test("exits with error on unknown nested command", async () => {
    const program = new CLI({ name: "semola-cli" });

    program
      .command("orm")
      .command("migrations")
      .command("create")
      .action(() => {
        //
      });

    const { exitCode, stderr } = await withExitStub(async () => {
      await program.parse(["orm", "migrations", "missing"]);
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Unknown command: missing");
  });

  test("prints help when parent command has subcommands and no action", async () => {
    const program = new CLI({ name: "semola-cli" });

    program
      .command("orm")
      .command("migrations")
      .command("create")
      .action(() => {
        //
      });

    const { help, exitCode } = await runHelp(program, ["orm"]);

    expect(exitCode).toBe(-1);
    expect(help).toContain("Usage: semola-cli orm [options]");
    expect(help).toContain("Commands:");
    expect(help).toContain("migrations");
  });

  test("prints schema descriptions in command help", async () => {
    const program = new CLI({ name: "pkg-cli" });

    program
      .command("publish")
      .argument("pkg", {
        schema: z.string().min(1).describe("The package to publish"),
      })
      .option("tag", {
        schema: z
          .string()
          .min(1)
          .describe("The tag to publish the package with"),
        aliases: ["t"],
      })
      .action(() => {});

    const { help } = await runHelp(program, ["publish", "--help"]);

    expect(help).toContain("The package to publish");
    expect(help).toContain("The tag to publish the package with");
  });

  test("prints command help for -h", async () => {
    const program = new CLI({
      name: "string-util",
      description: "String utilities",
    });

    program
      .command("publish")
      .argument("pkg", { schema: z.string() })
      .option("tag", { schema: z.string(), aliases: ["t"] })
      .action(() => {});

    const { help } = await runHelp(program, ["publish", "-h"]);

    expect(help).toContain("Usage: string-util publish <pkg>");
    expect(help).toContain("String utilities");
    expect(help).toContain("-t, --tag");
    expect(help).toContain("-h, --help");
    expect(help).not.toContain("-v, --version");
    expect(help).not.toContain("--tag\n\n  -h");
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

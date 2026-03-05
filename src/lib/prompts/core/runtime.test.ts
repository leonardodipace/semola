import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PromptError } from "../types.js";
import { createNodePromptRuntime, NodePromptRuntime } from "./runtime.js";

class MockStdin extends EventEmitter {
  public isTTY = true;
  public rawModes: boolean[] = [];
  public encoding: BufferEncoding | null = null;
  public resumed = false;

  public setRawMode(value: boolean) {
    this.rawModes.push(value);
  }

  public setEncoding(value: BufferEncoding) {
    this.encoding = value;
  }

  public resume() {
    this.resumed = true;
  }
}

class MockStdout {
  public isTTY = true;
  public writes: string[] = [];

  public write(chunk: string | Uint8Array) {
    this.writes.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    return true;
  }
}

describe("NodePromptRuntime", () => {
  test("createNodePromptRuntime should return NodePromptRuntime", () => {
    const runtime = createNodePromptRuntime();

    expect(runtime).toBeInstanceOf(NodePromptRuntime);
  });

  test("isInteractive should return false when tty is unavailable", () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();
    stdin.isTTY = false;

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    expect(runtime.isInteractive()).toBe(false);
  });

  test("init should throw environment error when not interactive", () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();
    stdout.isTTY = false;

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    expect(() => runtime.init()).toThrow(
      new PromptError(
        "PromptEnvironmentError",
        "Interactive prompts require a TTY with raw mode support",
      ),
    );
  });

  test("init should setup raw mode and close should restore terminal", () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    runtime.init();

    expect(stdin.rawModes).toEqual([true]);
    expect(stdin.encoding).toBe("utf8");
    expect(stdin.resumed).toBe(true);
    expect(stdin.listenerCount("data")).toBe(1);
    expect(stdout.writes[0]).toBe("\u001B[?25l");

    runtime.close();

    expect(stdin.rawModes).toEqual([true, false]);
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdout.writes.at(-1)).toBe("\u001B[?25h");
  });

  test("init should be idempotent", () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    runtime.init();
    runtime.init();

    expect(stdin.rawModes).toEqual([true]);
    expect(stdin.listenerCount("data")).toBe(1);
  });

  test("readKey should consume from queue when data arrives first", async () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    runtime.init();

    stdin.emit("data", "ab");

    const keyA = await runtime.readKey();
    const keyB = await runtime.readKey();

    expect(keyA).toEqual({ name: "character", value: "a" });
    expect(keyB).toEqual({ name: "character", value: "b" });
  });

  test("readKey should resolve waiter when data arrives later", async () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    runtime.init();

    const pending = runtime.readKey();
    stdin.emit("data", "\u001B[A");

    await expect(pending).resolves.toEqual({ name: "up" });
  });

  test("render should clear and move cursor up for multi-line frames", () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    runtime.init();
    runtime.render("line 1\nline 2");
    runtime.render("line 3");

    expect(stdout.writes).toContain("\u001B[1A");
    expect(stdout.writes).toContain("\r\u001B[J");
    expect(stdout.writes).toContain("line 1\nline 2");
    expect(stdout.writes).toContain("line 3");
  });

  test("done should write trailing newline and reset internal lines", () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    runtime.init();
    runtime.render("line 1\nline 2");
    runtime.done("✔ done");
    runtime.done("✔ done again");

    expect(stdout.writes).toContain("\u001B[1A");
    expect(stdout.writes).toContain("✔ done\n");
    expect(stdout.writes).toContain("✔ done again\n");
  });

  test("interrupt should close runtime and call process.exit", () => {
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const runtime = new NodePromptRuntime(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );

    runtime.init();

    let exitCode = -1;
    const originalExit = process.exit;

    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      return undefined as never;
    }) as typeof process.exit;

    try {
      runtime.interrupt("bye");
    } finally {
      process.exit = originalExit;
    }

    expect(exitCode).toBe(0);
    expect(stdin.rawModes).toEqual([true, false]);
    expect(stdout.writes.at(-1)).toBe("\u001B[?25h");
  });
});

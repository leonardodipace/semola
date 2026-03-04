import { PromptError } from "../types.js";
import { parseKeys } from "./keys.js";
import type { Key, PromptRuntime } from "./types.js";

const HIDE_CURSOR = "\u001B[?25l";
const SHOW_CURSOR = "\u001B[?25h";

const countLines = (text: string) => {
  return text.split("\n").length;
};

export class NodePromptRuntime implements PromptRuntime {
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private readonly queue: Key[] = [];
  private readonly waiters: Array<(key: Key) => void> = [];
  private initialized = false;
  private previousLines = 0;

  public constructor(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout,
  ) {
    this.stdin = stdin;
    this.stdout = stdout;
  }

  public isInteractive() {
    return Boolean(
      this.stdin.isTTY &&
        this.stdout.isTTY &&
        typeof this.stdin.setRawMode === "function",
    );
  }

  public init() {
    if (!this.isInteractive()) {
      throw new PromptError(
        "PromptEnvironmentError",
        "Interactive prompts require a TTY with raw mode support",
      );
    }

    if (this.initialized) {
      return;
    }

    this.initialized = true;

    this.stdin.setRawMode(true);
    this.stdin.setEncoding("utf8");
    this.stdin.resume();
    this.stdin.on("data", this.onData);
    this.stdout.write(HIDE_CURSOR);
  }

  public readKey() {
    const queued = this.queue.shift();

    if (queued) {
      return Promise.resolve(queued);
    }

    return new Promise<Key>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  public render(frame: string) {
    if (this.previousLines > 1) {
      this.stdout.write(`\u001B[${this.previousLines - 1}A`);
    }

    this.stdout.write("\r\u001B[J");
    this.stdout.write(frame);

    this.previousLines = countLines(frame);
  }

  public done(frame: string) {
    if (this.previousLines > 1) {
      this.stdout.write(`\u001B[${this.previousLines - 1}A`);
    }

    this.stdout.write("\r\u001B[J");
    this.stdout.write(`${frame}\n`);
    this.previousLines = 0;
  }

  public close() {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;
    this.stdin.off("data", this.onData);
    this.stdin.setRawMode(false);
    this.stdout.write(SHOW_CURSOR);
  }

  public interrupt(_message: string): undefined {
    this.close();
    process.exit(0);
  }

  private onData = (chunk: Buffer | string) => {
    const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const keys = parseKeys(value);

    for (const key of keys) {
      const waiter = this.waiters.shift();

      if (waiter) {
        waiter(key);
      } else {
        this.queue.push(key);
      }
    }
  };
}

export const createNodePromptRuntime = () => {
  return new NodePromptRuntime();
};

import { mightThrowSync } from "../../errors/index.js";
import { PromptEnvironmentError, PromptIOError } from "../errors.js";
import { parseKeys } from "./keys.js";
import type { Key, PromptRuntime, Waiter } from "./types.js";

const HIDE_CURSOR = "\u001B[?25l";
const SHOW_CURSOR = "\u001B[?25h";

const countLines = (text: string) => {
  let count = 1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      count += 1;
    }
  }

  return count;
};

type StdinLike = {
  isTTY?: boolean;
  setRawMode: (mode: boolean) => void;
  setEncoding: (encoding: BufferEncoding) => void;
  resume: () => void;
  pause?: () => void;
  on: (event: string, listener: (chunk: Buffer | string) => void) => unknown;
  off: (event: string, listener: (chunk: Buffer | string) => void) => unknown;
};

type StdoutLike = {
  isTTY?: boolean;
  write: (chunk: string) => boolean;
};

export class NodePromptRuntime implements PromptRuntime {
  private readonly stdin: StdinLike;
  private readonly stdout: StdoutLike;
  private readonly queue: Key[] = [];
  private readonly waiters: Waiter[] = [];
  private initialized = false;
  private previousLines = 0;
  private buffer = "";

  public constructor(
    stdin: StdinLike = process.stdin,
    stdout: StdoutLike = process.stdout,
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
      throw new PromptEnvironmentError(
        "Interactive prompts require a TTY with raw mode support",
      );
    }

    if (this.initialized) {
      return;
    }

    const [initError] = mightThrowSync(() => {
      this.stdin.setRawMode(true);
      this.stdin.setEncoding("utf8");
      this.stdin.resume();
      this.stdin.on("data", this.onData);
      this.stdout.write(HIDE_CURSOR);
    });

    if (initError) {
      throw new PromptIOError("Unable to initialize prompt runtime");
    }

    this.initialized = true;
    return;
  }

  public readKey(): Promise<Key> {
    const queued = this.queue.shift();

    if (queued) {
      return Promise.resolve(queued);
    }

    return new Promise<Key>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  public render(frame: string) {
    const [renderError] = mightThrowSync(() => {
      if (this.previousLines > 1) {
        this.stdout.write(`\u001B[${this.previousLines - 1}A`);
      }

      this.stdout.write("\r\u001B[J");
      this.stdout.write(frame);

      this.previousLines = countLines(frame);
    });

    if (renderError) {
      throw new PromptIOError("Unable to render prompt frame");
    }

    return;
  }

  public done(frame: string) {
    const [doneError] = mightThrowSync(() => {
      if (this.previousLines > 1) {
        this.stdout.write(`\u001B[${this.previousLines - 1}A`);
      }

      this.stdout.write("\r\u001B[J");
      this.stdout.write(`${frame}\n`);
      this.previousLines = 0;
    });

    if (doneError) {
      throw new PromptIOError("Unable to finalize prompt frame");
    }

    return;
  }

  public close() {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;

    const [closeError] = mightThrowSync(() => {
      this.stdin.off("data", this.onData);
      this.stdin.setRawMode(false);
      this.stdin.pause?.();
      this.stdout.write(SHOW_CURSOR);
    });

    if (closeError) {
      throw new PromptIOError("Unable to close prompt runtime");
    }

    return;
  }

  public interrupt(): never {
    this.close();
    process.exit(0);
  }

  private onData = (chunk: Buffer | string) => {
    const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const combined = `${this.buffer}${value}`;
    this.buffer = "";

    const [parseError, result] = mightThrowSync(() => parseKeys(combined));

    if (parseError || !result) {
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(new PromptIOError("Failed to parse input"));
      }

      return;
    }

    this.buffer = result.remaining;

    for (const key of result.keys) {
      const waiter = this.waiters.shift();

      if (waiter) {
        waiter.resolve(key);
      } else {
        this.queue.push(key);
      }
    }
  };
}

export const createNodePromptRuntime = () => {
  return new NodePromptRuntime();
};

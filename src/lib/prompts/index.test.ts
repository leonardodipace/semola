import { describe, expect, test } from "bun:test";
import type { Key, PromptRuntime } from "./core/types.js";
import {
  confirm,
  input,
  multiselect,
  number,
  password,
  select,
} from "./index.js";
import { PromptError } from "./types.js";

const stripAnsi = (value: string) => {
  return Bun.stripANSI(value);
};

class MockPromptRuntime implements PromptRuntime {
  private readonly keys: Key[];
  private readonly interactive: boolean;
  public frames: string[] = [];
  public doneFrames: string[] = [];
  public closed = false;

  public constructor(keys: Key[], interactive = true) {
    this.keys = [...keys];
    this.interactive = interactive;
  }

  public isInteractive() {
    return this.interactive;
  }

  public init() {
    if (!this.interactive) {
      throw new PromptError(
        "PromptEnvironmentError",
        "Interactive prompts require a TTY with raw mode support",
      );
    }
  }

  public readKey() {
    const key = this.keys.shift();

    if (!key) {
      throw new Error("No more mock keys available");
    }

    return Promise.resolve(key);
  }

  public render(frame: string) {
    this.frames.push(frame);
  }

  public done(frame: string) {
    this.doneFrames.push(frame);
  }

  public close() {
    this.closed = true;
  }
}

describe("prompts", () => {
  test("input should collect characters and submit", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "h" },
      { name: "character", value: "i" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("hi");
    const doneFrame = runtime.doneFrames.at(-1);

    expect(stripAnsi(doneFrame ?? "")).toContain("✔ Name hi");
  });

  test("password should hide displayed value and resolve raw value", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "s" },
      { name: "character", value: "3" },
      { name: "character", value: "c" },
      { name: "character", value: "r" },
      { name: "character", value: "e" },
      { name: "character", value: "t" },
      { name: "enter" },
    ]);

    const value = await password({ message: "Password" }, runtime);
    expect(value).toBe("s3cret");
    expect(runtime.frames.at(-1)).toContain("******");
  });

  test("confirm should toggle and submit", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "y" },
      { name: "enter" },
    ]);

    const value = await confirm({ message: "Continue?" }, runtime);
    expect(value).toBe(true);
  });

  test("number should validate min and then pass", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "5" },
      { name: "enter" },
      { name: "backspace" },
      { name: "character", value: "1" },
      { name: "character", value: "0" },
      { name: "enter" },
    ]);

    const value = await number({ message: "Count", min: 10 }, runtime);
    expect(value).toBe(10);
    const hasValidationError = runtime.frames.some((frame) =>
      frame.includes("greater than or equal to 10"),
    );
    expect(hasValidationError).toBe(true);
  });

  test("select should move and pick an option", async () => {
    const runtime = new MockPromptRuntime([
      { name: "down" },
      { name: "enter" },
    ]);

    const value = await select(
      {
        message: "Color",
        choices: [{ value: "red" }, { value: "blue" }, { value: "green" }],
      },
      runtime,
    );

    expect(value).toBe("blue");
  });

  test("multiselect should toggle multiple values", async () => {
    const runtime = new MockPromptRuntime([
      { name: "space" },
      { name: "down" },
      { name: "space" },
      { name: "enter" },
    ]);

    const value = await multiselect(
      {
        message: "Tools",
        choices: [{ value: "bun" }, { value: "biome" }, { value: "ts" }],
      },
      runtime,
    );

    expect(value).toEqual(["bun", "biome"]);
  });

  test("multiselect should toggle all enabled values with a", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "enter" },
    ]);

    const value = await multiselect(
      {
        message: "Tools",
        choices: [{ value: "bun" }, { value: "biome" }, { value: "ts" }],
      },
      runtime,
    );

    expect(value).toEqual(["bun", "biome", "ts"]);
  });

  test("multiselect should not toggle disabled values with a", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "enter" },
    ]);

    const value = await multiselect(
      {
        message: "Tools",
        choices: [
          { value: "bun" },
          { value: "biome", disabled: true },
          { value: "ts" },
        ],
      },
      runtime,
    );

    expect(value).toEqual(["bun", "ts"]);
  });

  test("should throw cancelled error on escape", async () => {
    const runtime = new MockPromptRuntime([{ name: "escape" }]);

    await expect(input({ message: "Name" }, runtime)).rejects.toMatchObject({
      type: "PromptCancelledError",
      message: "Interrupted, bye!",
    });
  });

  test("should throw environment error when runtime is not interactive", async () => {
    const runtime = new MockPromptRuntime([], false);

    await expect(input({ message: "Name" }, runtime)).rejects.toMatchObject({
      type: "PromptEnvironmentError",
      message: "Interactive prompts require a TTY with raw mode support",
    });
  });

  test("should support validate and transform callbacks", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "enter" },
      { name: "backspace" },
      { name: "character", value: "n" },
      { name: "character", value: "o" },
      { name: "character", value: "k" },
      { name: "enter" },
    ]);

    const value = await input(
      {
        message: "Tag",
        validate: (raw) => (raw.length < 2 ? "Too short" : null),
        transform: (raw) => raw.toUpperCase(),
      },
      runtime,
    );

    expect(value).toBe("NOK");
  });

  test("input should delete previous word on ctrl+backspace", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "h" },
      { name: "character", value: "e" },
      { name: "character", value: "l" },
      { name: "character", value: "l" },
      { name: "character", value: "o" },
      { name: "space" },
      { name: "character", value: "w" },
      { name: "character", value: "o" },
      { name: "character", value: "r" },
      { name: "character", value: "l" },
      { name: "character", value: "d" },
      { name: "ctrl_backspace" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("hello ");
  });

  test("input should replace selection created by shift+arrow", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "h" },
      { name: "character", value: "e" },
      { name: "character", value: "l" },
      { name: "character", value: "l" },
      { name: "character", value: "o" },
      { name: "space" },
      { name: "character", value: "w" },
      { name: "character", value: "o" },
      { name: "character", value: "r" },
      { name: "character", value: "l" },
      { name: "character", value: "d" },
      { name: "shift_left" },
      { name: "shift_left" },
      { name: "shift_left" },
      { name: "shift_left" },
      { name: "shift_left" },
      { name: "character", value: "b" },
      { name: "character", value: "u" },
      { name: "character", value: "n" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("hello bun");
  });

  test("input should jump by words with ctrl+arrows", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "h" },
      { name: "character", value: "e" },
      { name: "character", value: "l" },
      { name: "character", value: "l" },
      { name: "character", value: "o" },
      { name: "space" },
      { name: "character", value: "w" },
      { name: "character", value: "o" },
      { name: "character", value: "r" },
      { name: "character", value: "l" },
      { name: "character", value: "d" },
      { name: "ctrl_left" },
      { name: "character", value: "X" },
      { name: "ctrl_right" },
      { name: "character", value: "!" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("hello Xworld!");
  });
});

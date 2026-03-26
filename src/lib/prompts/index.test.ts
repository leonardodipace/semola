import { describe, expect, test } from "bun:test";
import { err, ok } from "../errors/index.js";
import type { Key, PromptRuntime } from "./core/types.js";
import {
  confirm as confirmPrompt,
  input as inputPrompt,
  multiselect as multiselectPrompt,
  number as numberPrompt,
  password as passwordPrompt,
  select as selectPrompt,
} from "./index.js";
import type {
  ConfirmOptions,
  InputOptions,
  MultiselectOptions,
  NumberOptions,
  PasswordOptions,
  SelectOptions,
} from "./types.js";

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
      return err(
        "PromptEnvironmentError",
        "Interactive prompts require a TTY with raw mode support",
      );
    }

    return ok(undefined);
  }

  public readKey() {
    const key = this.keys.shift();

    if (!key) {
      return Promise.resolve(
        err("PromptIOError", "No more mock keys available"),
      );
    }

    return Promise.resolve(ok(key));
  }

  public render(frame: string) {
    this.frames.push(frame);
    return ok(undefined);
  }

  public done(frame: string) {
    this.doneFrames.push(frame);
    return ok(undefined);
  }

  public close() {
    this.closed = true;
    return ok(undefined);
  }
}

const input = async (options: InputOptions, runtime?: PromptRuntime) => {
  return inputPrompt(options, runtime);
};

const password = async (options: PasswordOptions, runtime?: PromptRuntime) => {
  return passwordPrompt(options, runtime);
};

const confirm = async (options: ConfirmOptions, runtime?: PromptRuntime) => {
  return confirmPrompt(options, runtime);
};

const number = async (options: NumberOptions, runtime?: PromptRuntime) => {
  return numberPrompt(options, runtime);
};

const select = async <TValue extends string>(
  options: SelectOptions<TValue>,
  runtime?: PromptRuntime,
) => {
  return selectPrompt(options, runtime);
};

const multiselect = async <TValue extends string>(
  options: MultiselectOptions<TValue>,
  runtime?: PromptRuntime,
) => {
  return multiselectPrompt(options, runtime);
};

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
    expect(stripAnsi(runtime.frames.at(-1) ?? "")).not.toContain("s3cret");
    expect(stripAnsi(runtime.doneFrames.at(-1) ?? "")).toContain("✔ Password");
    expect(stripAnsi(runtime.doneFrames.at(-1) ?? "")).not.toContain("s3cret");
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

  test("should return cancelled error on escape", async () => {
    const runtime = new MockPromptRuntime([{ name: "escape" }]);

    await expect(
      inputPrompt({ message: "Name" }, runtime),
    ).rejects.toMatchObject({
      name: "PromptCancelledError",
      message: "Interrupted, bye!",
    });
  });

  test("should return environment error when runtime is not interactive", async () => {
    const runtime = new MockPromptRuntime([], false);

    await expect(
      inputPrompt({ message: "Name" }, runtime),
    ).rejects.toMatchObject({
      name: "PromptEnvironmentError",
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

  test("input should use default value when submitted empty", async () => {
    const runtime = new MockPromptRuntime([{ name: "enter" }]);

    const value = await input(
      { message: "Project", defaultValue: "semola" },
      runtime,
    );

    expect(value).toBe("semola");
  });

  test("input should block required empty values", async () => {
    const runtime = new MockPromptRuntime([
      { name: "space" },
      { name: "enter" },
      { name: "character", value: "o" },
      { name: "character", value: "k" },
      { name: "enter" },
    ]);

    const value = await input(
      {
        message: "Tag",
        required: true,
      },
      runtime,
    );

    expect(value).toBe(" ok");
    const hasRequiredError = runtime.frames.some((frame) =>
      frame.includes("A value is required"),
    );
    expect(hasRequiredError).toBe(true);
  });

  test("input should render placeholder when empty", async () => {
    const runtime = new MockPromptRuntime([{ name: "enter" }]);

    await input(
      {
        message: "Name",
        placeholder: "Type your name",
      },
      runtime,
    );

    const firstFrame = stripAnsi(runtime.frames[0] ?? "");
    expect(firstFrame).toContain("Type your name");
  });

  test("input should support home and end keys", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "character", value: "b" },
      { name: "character", value: "c" },
      { name: "home" },
      { name: "character", value: "X" },
      { name: "end" },
      { name: "character", value: "Y" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("XabcY");
  });

  test("input should select all with ctrl+a and replace", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "h" },
      { name: "character", value: "e" },
      { name: "character", value: "l" },
      { name: "character", value: "l" },
      { name: "character", value: "o" },
      { name: "ctrl_a" },
      { name: "character", value: "A" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("A");
  });

  test("input should remove next character on delete", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "character", value: "b" },
      { name: "character", value: "c" },
      { name: "character", value: "d" },
      { name: "left" },
      { name: "left" },
      { name: "delete" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("abd");
  });

  test("input should replace shift+ctrl word selection", async () => {
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
      { name: "space" },
      { name: "character", value: "a" },
      { name: "character", value: "g" },
      { name: "character", value: "a" },
      { name: "character", value: "i" },
      { name: "character", value: "n" },
      { name: "shift_ctrl_left" },
      { name: "character", value: "X" },
      { name: "enter" },
    ]);

    const value = await input({ message: "Name" }, runtime);
    expect(value).toBe("hello world X");
  });

  test("password should use custom mask", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "character", value: "b" },
      { name: "enter" },
    ]);

    const value = await password({ message: "Password", mask: "•" }, runtime);
    expect(value).toBe("ab");
    expect(runtime.frames.at(-1)).toContain("••");
    expect(stripAnsi(runtime.doneFrames.at(-1) ?? "")).toContain(
      "✔ Password ••",
    );
  });

  test("password should resolve raw value after backspace", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "character", value: "b" },
      { name: "character", value: "c" },
      { name: "backspace" },
      { name: "enter" },
    ]);

    const value = await password({ message: "Password" }, runtime);
    expect(value).toBe("ab");
    expect(stripAnsi(runtime.frames.at(-1) ?? "")).not.toContain("ab");
  });

  test("password should use defaultValue when nothing is typed", async () => {
    const runtime = new MockPromptRuntime([{ name: "enter" }]);

    const value = await password(
      { message: "Password", defaultValue: "fallback" },
      runtime,
    );

    expect(value).toBe("fallback");
    expect(stripAnsi(runtime.doneFrames.at(-1) ?? "")).toContain("✔ Password");
    expect(stripAnsi(runtime.doneFrames.at(-1) ?? "")).not.toContain(
      "fallback",
    );
  });

  test("password should require a value when required is set", async () => {
    const runtime = new MockPromptRuntime([
      { name: "enter" },
      { name: "character", value: "x" },
      { name: "enter" },
    ]);

    const value = await password(
      { message: "Password", required: true },
      runtime,
    );
    expect(value).toBe("x");
  });

  test("password should show placeholder when empty", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "p" },
      { name: "enter" },
    ]);

    const runtime2 = new MockPromptRuntime([{ name: "enter" }]);

    await password(
      { message: "Password", placeholder: "enter password", defaultValue: "p" },
      runtime,
    );
    await password(
      { message: "Password", placeholder: "enter password" },
      runtime2,
    );

    expect(runtime2.frames[0]).toContain("enter password");
  });

  test("confirm should respond to arrow keys and space", async () => {
    const runtime = new MockPromptRuntime([
      { name: "left" },
      { name: "right" },
      { name: "space" },
      { name: "enter" },
    ]);

    const value = await confirm(
      { message: "Continue?", defaultValue: false },
      runtime,
    );

    expect(value).toBe(true);
  });

  test("confirm should render custom success labels", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "n" },
      { name: "enter" },
    ]);

    const value = await confirm(
      {
        message: "Deploy?",
        activeLabel: "Ship it",
        inactiveLabel: "Not yet",
      },
      runtime,
    );

    expect(value).toBe(false);
    const done = stripAnsi(runtime.doneFrames.at(-1) ?? "");
    expect(done).toContain("Not yet");
  });

  test("number should ignore unsupported characters", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "1" },
      { name: "character", value: "a" },
      { name: "character", value: "2" },
      { name: "enter" },
    ]);

    const value = await number({ message: "Count" }, runtime);
    expect(value).toBe(12);
  });

  test("number should validate max boundary", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "9" },
      { name: "character", value: "9" },
      { name: "enter" },
      { name: "backspace" },
      { name: "backspace" },
      { name: "character", value: "1" },
      { name: "character", value: "0" },
      { name: "enter" },
    ]);

    const value = await number({ message: "Count", max: 10 }, runtime);
    expect(value).toBe(10);
    const hasValidationError = runtime.frames.some((frame) =>
      frame.includes("lower than or equal to 10"),
    );
    expect(hasValidationError).toBe(true);
  });

  test("number should use required message when empty", async () => {
    const runtime = new MockPromptRuntime([
      { name: "enter" },
      { name: "character", value: "7" },
      { name: "enter" },
    ]);

    const value = await number(
      {
        message: "Retries",
        requiredMessage: "Please enter retries",
      },
      runtime,
    );

    expect(value).toBe(7);
    const hasValidationError = runtime.frames.some((frame) =>
      frame.includes("Please enter retries"),
    );
    expect(hasValidationError).toBe(true);
  });

  test("select should skip disabled options and wrap", async () => {
    const runtime = new MockPromptRuntime([{ name: "up" }, { name: "enter" }]);

    const value = await select(
      {
        message: "Color",
        choices: [
          { value: "red", disabled: true },
          { value: "blue" },
          { value: "green", disabled: true },
          { value: "yellow" },
        ],
      },
      runtime,
    );

    expect(value).toBe("yellow");
  });

  test("select should fallback when default value is disabled", async () => {
    const runtime = new MockPromptRuntime([{ name: "enter" }]);

    const value = await select(
      {
        message: "Runtime",
        defaultValue: "node",
        choices: [{ value: "node", disabled: true }, { value: "bun" }],
      },
      runtime,
    );

    expect(value).toBe("bun");
  });

  test("multiselect should enforce min selections", async () => {
    const runtime = new MockPromptRuntime([
      { name: "enter" },
      { name: "space" },
      { name: "down" },
      { name: "space" },
      { name: "enter" },
    ]);

    const value = await multiselect(
      {
        message: "Tools",
        choices: [{ value: "bun" }, { value: "biome" }, { value: "ts" }],
        min: 2,
      },
      runtime,
    );

    expect(value).toEqual(["bun", "biome"]);
    const hasValidationError = runtime.frames.some((frame) =>
      frame.includes("Please select at least 2 options"),
    );
    expect(hasValidationError).toBe(true);
  });

  test("multiselect should enforce max selections", async () => {
    const runtime = new MockPromptRuntime([
      { name: "space" },
      { name: "down" },
      { name: "space" },
      { name: "down" },
      { name: "space" },
      { name: "enter" },
      { name: "space" },
      { name: "enter" },
    ]);

    const value = await multiselect(
      {
        message: "Tools",
        choices: [{ value: "bun" }, { value: "biome" }, { value: "ts" }],
        max: 2,
      },
      runtime,
    );

    expect(value).toEqual(["bun", "biome"]);
    const hasValidationError = runtime.frames.some((frame) =>
      frame.includes("Please select at most 2 options"),
    );
    expect(hasValidationError).toBe(true);
  });

  test("multiselect should toggle all twice", async () => {
    const runtime = new MockPromptRuntime([
      { name: "character", value: "a" },
      { name: "character", value: "a" },
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

    expect(value).toEqual(["biome"]);
  });

  test("multiselect should return values in choice order", async () => {
    const runtime = new MockPromptRuntime([{ name: "enter" }]);

    const value = await multiselect(
      {
        message: "Tools",
        choices: [{ value: "bun" }, { value: "biome" }, { value: "ts" }],
        defaultValue: ["ts", "bun"],
      },
      runtime,
    );

    expect(value).toEqual(["bun", "ts"]);
  });
});

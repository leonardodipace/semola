import { describe, expect, test } from "bun:test";
import type { BasePromptOptions } from "../types.js";
import { runPromptSession } from "./session.js";
import type { Key, PromptRuntime } from "./types.js";

type TextState = {
  value: string;
};

class MockSessionRuntime implements PromptRuntime {
  private readonly keys: Key[];
  public frames: string[] = [];
  public doneFrames: string[] = [];
  public closed = false;
  public interruptMessage: string | null = null;

  public constructor(keys: Key[]) {
    this.keys = [...keys];
  }

  public isInteractive() {
    return true;
  }

  public init() {}

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

  public interrupt(message: string) {
    this.interruptMessage = message;
    return undefined;
  }
}

const createSessionOptions = (
  options: BasePromptOptions<string>,
  runtime: PromptRuntime,
) => {
  return {
    runtime,
    options,
    initialState: { value: "" } satisfies TextState,
    render: ({
      state,
      errorMessage,
    }: {
      state: TextState;
      errorMessage: string | null;
    }) => {
      if (!errorMessage) {
        return `> ${state.value}`;
      }

      return `> ${state.value} (${errorMessage})`;
    },
    complete: ({ value }: { value: string }) => {
      return `✔ ${value}`;
    },
    onKey: (state: TextState, key: Key) => {
      if (key.name === "character") {
        return { value: `${state.value}${key.value ?? ""}` };
      }

      if (key.name === "backspace") {
        return { value: state.value.slice(0, -1) };
      }

      return state;
    },
    onSubmit: (state: TextState) => {
      if (state.value.length === 0) {
        return { errorMessage: "Value required" };
      }

      return { value: state.value };
    },
  };
};

describe("runPromptSession", () => {
  test("should complete with submitted value", async () => {
    const runtime = new MockSessionRuntime([
      { name: "character", value: "o" },
      { name: "character", value: "k" },
      { name: "enter" },
    ]);

    const value = await runPromptSession(
      createSessionOptions({ message: "Name" }, runtime),
    );

    expect(value).toBe("ok");
    expect(runtime.closed).toBe(true);
    expect(runtime.doneFrames.at(-1)).toBe("✔ ok");
  });

  test("should re-render with submit error and recover", async () => {
    const runtime = new MockSessionRuntime([
      { name: "enter" },
      { name: "character", value: "a" },
      { name: "enter" },
    ]);

    const value = await runPromptSession(
      createSessionOptions({ message: "Name" }, runtime),
    );

    expect(value).toBe("a");
    const hasSubmitError = runtime.frames.some((frame) =>
      frame.includes("Value required"),
    );
    expect(hasSubmitError).toBe(true);
  });

  test("should cancel on escape and call interrupt", async () => {
    const runtime = new MockSessionRuntime([{ name: "escape" }]);

    await expect(
      runPromptSession(createSessionOptions({ message: "Name" }, runtime)),
    ).rejects.toMatchObject({
      type: "PromptCancelledError",
      message: "Interrupted, bye!",
    });

    expect(runtime.closed).toBe(true);
    expect(runtime.doneFrames.at(-1)).toContain("Interrupted, bye!");
    expect(runtime.interruptMessage).toBe("Interrupted, bye!");
  });

  test("should cancel on ctrl+c", async () => {
    const runtime = new MockSessionRuntime([{ name: "ctrl_c" }]);

    await expect(
      runPromptSession(createSessionOptions({ message: "Name" }, runtime)),
    ).rejects.toMatchObject({
      type: "PromptCancelledError",
    });

    expect(runtime.closed).toBe(true);
  });

  test("should keep asking when validate returns message", async () => {
    const runtime = new MockSessionRuntime([
      { name: "character", value: "n" },
      { name: "enter" },
      { name: "backspace" },
      { name: "character", value: "o" },
      { name: "character", value: "k" },
      { name: "enter" },
    ]);

    const value = await runPromptSession(
      createSessionOptions(
        {
          message: "Name",
          validate: (raw) => {
            if (raw !== "ok") {
              return "Not ok";
            }

            return null;
          },
        },
        runtime,
      ),
    );

    expect(value).toBe("ok");
    const hasValidationError = runtime.frames.some((frame) =>
      frame.includes("Not ok"),
    );
    expect(hasValidationError).toBe(true);
  });

  test("should throw prompt io error when validate throws", async () => {
    const runtime = new MockSessionRuntime([
      { name: "character", value: "a" },
      { name: "enter" },
    ]);

    await expect(
      runPromptSession(
        createSessionOptions(
          {
            message: "Name",
            validate: () => {
              throw new Error("boom");
            },
          },
          runtime,
        ),
      ),
    ).rejects.toMatchObject({
      type: "PromptIOError",
      message: "Prompt validate callback failed unexpectedly",
    });

    expect(runtime.closed).toBe(true);
    expect(runtime.doneFrames.at(-1)).toBe("✖ Name");
  });

  test("should apply transform callback", async () => {
    const runtime = new MockSessionRuntime([
      { name: "character", value: "a" },
      { name: "character", value: "b" },
      { name: "enter" },
    ]);

    const value = await runPromptSession(
      createSessionOptions(
        {
          message: "Name",
          transform: (raw) => raw.toUpperCase(),
        },
        runtime,
      ),
    );

    expect(value).toBe("AB");
    expect(runtime.doneFrames.at(-1)).toBe("✔ AB");
  });

  test("should throw prompt io error when transform throws", async () => {
    const runtime = new MockSessionRuntime([
      { name: "character", value: "a" },
      { name: "enter" },
    ]);

    await expect(
      runPromptSession(
        createSessionOptions(
          {
            message: "Name",
            transform: () => {
              throw new Error("boom");
            },
          },
          runtime,
        ),
      ),
    ).rejects.toMatchObject({
      type: "PromptIOError",
      message: "Prompt transform callback failed unexpectedly",
    });

    expect(runtime.closed).toBe(true);
    expect(runtime.doneFrames.at(-1)).toBe("✖ Name");
  });
});

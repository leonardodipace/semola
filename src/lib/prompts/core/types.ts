import type { err, ok } from "../../errors/index.js";

export type PromptResultLike<T> =
  | ReturnType<typeof err<string>>
  | ReturnType<typeof ok<T>>;

export type KeyName =
  | "character"
  | "enter"
  | "backspace"
  | "delete"
  | "up"
  | "down"
  | "left"
  | "right"
  | "ctrl_left"
  | "ctrl_right"
  | "shift_left"
  | "shift_right"
  | "space"
  | "escape"
  | "ctrl_c"
  | "ctrl_backspace"
  | "ctrl_a"
  | "home"
  | "end"
  | "shift_ctrl_left"
  | "shift_ctrl_right"
  | "tab";

export type Key = {
  name: KeyName;
  value?: string;
};

export type PromptRuntime = {
  isInteractive: () => boolean;
  init: () => PromptResultLike<void>;
  readKey: () => Promise<PromptResultLike<Key>>;
  render: (frame: string) => PromptResultLike<void>;
  done: (frame: string) => PromptResultLike<void>;
  close: () => PromptResultLike<void>;
  interrupt?: (message: string) => PromptResultLike<undefined>;
};

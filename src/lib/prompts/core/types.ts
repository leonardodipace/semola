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
  init: () => void;
  readKey: () => Promise<Key>;
  render: (frame: string) => void;
  done: (frame: string) => void;
  close: () => void;
  interrupt?: (message: string) => void;
};

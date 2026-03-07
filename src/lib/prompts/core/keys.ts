import type { Key } from "./types.js";

const ESC = "\u001B";
const CSI = "\u001B[";
const ESC_BACKSPACE = `${ESC}\u007F`;

const KNOWN_SEQUENCES = [
  { sequence: "\u001B[1;2D", key: { name: "shift_left" } },
  { sequence: "\u001B[1;2C", key: { name: "shift_right" } },
  { sequence: "\u001B[1;5D", key: { name: "ctrl_left" } },
  { sequence: "\u001B[1;5C", key: { name: "ctrl_right" } },
  { sequence: "\u001B[1;6D", key: { name: "shift_ctrl_left" } },
  { sequence: "\u001B[1;6C", key: { name: "shift_ctrl_right" } },
  { sequence: "\u001B[3~", key: { name: "delete" } },
  { sequence: "\u001B[H", key: { name: "home" } },
  { sequence: "\u001B[F", key: { name: "end" } },
  { sequence: "\u001B[A", key: { name: "up" } },
  { sequence: "\u001B[B", key: { name: "down" } },
  { sequence: "\u001B[C", key: { name: "right" } },
  { sequence: "\u001B[D", key: { name: "left" } },
] as const;

const isControlChar = (char: string) => {
  return char <= "\u001F" || char === "\u007F";
};

const isCsiFinalByte = (char: string) => {
  if (!char) {
    return false;
  }

  if (char >= "A" && char <= "Z") {
    return true;
  }

  if (char >= "a" && char <= "z") {
    return true;
  }

  if (char === "~") {
    return true;
  }

  return false;
};

const readCsiLength = (remaining: string) => {
  if (!remaining.startsWith(CSI)) {
    return null;
  }

  let index = CSI.length;

  while (index < remaining.length) {
    const char = remaining[index] ?? "";

    if (isCsiFinalByte(char)) {
      return { length: index + 1, incomplete: false };
    }

    index += 1;
  }

  return { length: 0, incomplete: true };
};

export const parseKeys = (chunk: string) => {
  const keys: Key[] = [];

  let cursor = 0;

  while (cursor < chunk.length) {
    const remaining = chunk.slice(cursor);

    if (remaining.startsWith(ESC_BACKSPACE)) {
      keys.push({ name: "ctrl_backspace" });
      cursor += 2;
      continue;
    }

    const knownSequence = KNOWN_SEQUENCES.find((entry) =>
      remaining.startsWith(entry.sequence),
    );

    if (knownSequence) {
      keys.push(knownSequence.key);
      cursor += knownSequence.sequence.length;
      continue;
    }

    const csiLength = readCsiLength(remaining);

    if (csiLength) {
      if (csiLength.incomplete) {
        return { keys, remaining: chunk.slice(cursor) };
      }

      cursor += csiLength.length;
      continue;
    }

    const char = chunk[cursor] ?? "";

    if (char === "\r" || char === "\n") {
      keys.push({ name: "enter" });
      cursor += 1;
      continue;
    }

    if (char === "\u0001") {
      keys.push({ name: "ctrl_a" });
      cursor += 1;
      continue;
    }

    if (char === "\u0003") {
      keys.push({ name: "ctrl_c" });
      cursor += 1;
      continue;
    }

    if (char === "\u001B") {
      if (cursor === chunk.length - 1) {
        keys.push({ name: "escape" });
      }

      cursor += 1;
      continue;
    }

    if (char === "\u0017") {
      keys.push({ name: "ctrl_backspace" });
      cursor += 1;
      continue;
    }

    if (char === "\u007F") {
      keys.push({ name: "backspace" });
      cursor += 1;
      continue;
    }

    if (char === "\t") {
      keys.push({ name: "tab" });
      cursor += 1;
      continue;
    }

    if (char === " ") {
      keys.push({ name: "space" });
      cursor += 1;
      continue;
    }

    if (!isControlChar(char)) {
      keys.push({ name: "character", value: char });
    }

    cursor += 1;
  }

  return { keys, remaining: "" };
};

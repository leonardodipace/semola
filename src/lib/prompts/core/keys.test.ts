import { describe, expect, test } from "bun:test";
import { parseKeys } from "./keys.js";

describe("parseKeys", () => {
  test("should parse shift+arrow sequences", () => {
    const { keys } = parseKeys("\u001B[1;2D\u001B[1;2C");

    expect(keys).toEqual([{ name: "shift_left" }, { name: "shift_right" }]);
  });

  test("should parse ctrl+arrow sequences", () => {
    const { keys } = parseKeys("\u001B[1;5D\u001B[1;5C");

    expect(keys).toEqual([{ name: "ctrl_left" }, { name: "ctrl_right" }]);
  });

  test("should parse ctrl+backspace common sequences", () => {
    const ctrlW = parseKeys("\u0017");
    expect(ctrlW.keys).toEqual([{ name: "ctrl_backspace" }]);

    const altBackspace = parseKeys("\u001B\u007F");
    expect(altBackspace.keys).toEqual([{ name: "ctrl_backspace" }]);
  });

  test("should ignore unknown CSI instead of cancelling", () => {
    const { keys } = parseKeys("\u001B[1;9C");

    expect(keys).toEqual([]);
  });

  test("should parse shift+ctrl+arrow sequences", () => {
    const { keys } = parseKeys("\u001B[1;6D\u001B[1;6C");

    expect(keys).toEqual([
      { name: "shift_ctrl_left" },
      { name: "shift_ctrl_right" },
    ]);
  });

  test("should parse home, end and delete sequences", () => {
    const { keys } = parseKeys("\u001B[H\u001B[F\u001B[3~");

    expect(keys).toEqual([
      { name: "home" },
      { name: "end" },
      { name: "delete" },
    ]);
  });

  test("should parse arrows and enter keys", () => {
    const { keys } = parseKeys("\u001B[A\u001B[B\u001B[C\u001B[D\r\n");

    expect(keys).toEqual([
      { name: "up" },
      { name: "down" },
      { name: "right" },
      { name: "left" },
      { name: "enter" },
      { name: "enter" },
    ]);
  });

  test("should parse control and text keys", () => {
    const { keys } = parseKeys("\u0001\u0003\t \u007Fa");

    expect(keys).toEqual([
      { name: "ctrl_a" },
      { name: "ctrl_c" },
      { name: "tab" },
      { name: "space" },
      { name: "backspace" },
      { name: "character", value: "a" },
    ]);
  });

  test("should parse trailing escape as cancel", () => {
    const { keys } = parseKeys("abc\u001B");

    expect(keys).toEqual([
      { name: "character", value: "a" },
      { name: "character", value: "b" },
      { name: "character", value: "c" },
      { name: "escape" },
    ]);
  });

  test("should ignore standalone escape when not trailing", () => {
    const { keys } = parseKeys("a\u001Bb");

    expect(keys).toEqual([
      { name: "character", value: "a" },
      { name: "character", value: "b" },
    ]);
  });

  test("should return remaining bytes for incomplete CSI sequences", () => {
    const result = parseKeys("\u001B[");

    expect(result.keys).toEqual([]);
    expect(result.remaining).toBe("\u001B[");
  });

  test("should parse complete CSI after prepending buffered incomplete sequence", () => {
    const first = parseKeys("\u001B[");
    const second = parseKeys(`${first.remaining}A`);

    expect(second.keys).toEqual([{ name: "up" }]);
    expect(second.remaining).toBe("");
  });
});

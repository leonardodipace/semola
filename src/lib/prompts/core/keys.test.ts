import { describe, expect, test } from "bun:test";
import { parseKeys } from "./keys.js";

describe("parseKeys", () => {
  test("should parse shift+arrow sequences", () => {
    const keys = parseKeys("\u001B[1;2D\u001B[1;2C");

    expect(keys).toEqual([{ name: "shift_left" }, { name: "shift_right" }]);
  });

  test("should parse ctrl+arrow sequences", () => {
    const keys = parseKeys("\u001B[1;5D\u001B[1;5C");

    expect(keys).toEqual([{ name: "ctrl_left" }, { name: "ctrl_right" }]);
  });

  test("should parse ctrl+backspace common sequences", () => {
    const ctrlW = parseKeys("\u0017");
    expect(ctrlW).toEqual([{ name: "ctrl_backspace" }]);

    const altBackspace = parseKeys("\u001B\u007F");
    expect(altBackspace).toEqual([{ name: "ctrl_backspace" }]);
  });

  test("should ignore unknown CSI instead of cancelling", () => {
    const keys = parseKeys("\u001B[1;9C");

    expect(keys).toEqual([]);
  });
});

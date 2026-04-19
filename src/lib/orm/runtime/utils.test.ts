import { describe, expect, test } from "bun:test";
import { expectSingleRow, toWhereInput } from "./utils.js";

describe("expectSingleRow", () => {
  test("returns falsy rows without throwing", async () => {
    await expect(expectSingleRow([0], "missing")).resolves.toBe(0);
    await expect(expectSingleRow([false], "missing")).resolves.toBe(false);
    await expect(expectSingleRow([""], "missing")).resolves.toBe("");
  });

  test("throws when rows are empty", async () => {
    await expect(expectSingleRow([], "missing")).rejects.toThrow("missing");
  });
});

describe("toWhereInput", () => {
  test("ignores prototype-polluting keys", () => {
    const input = {
      id: "1",
      __proto__: { polluted: true },
      constructor: { nope: true },
      prototype: { nope: true },
    };

    const where = toWhereInput(input);

    expect(Reflect.get(where, "id")).toBe("1");
    expect(Reflect.get(where, "polluted")).toBeUndefined();
    expect(Object.hasOwn(where, "constructor")).toBe(false);
    expect(Object.hasOwn(where, "prototype")).toBe(false);
  });
});

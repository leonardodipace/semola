import { describe, test, expect } from "bun:test";
import { fuzzySearch } from "./fuzzy.js";
import type { FuzzyResult } from "./types.js";

describe("Fuzzy Search", () => {
  test("should return a list of results with 'apple' in the first place", () => {
    const search = fuzzySearch({
      data: ["apple", "watermelon", "lime", "peach"],
    });

    const res = search("aple");
    expect(res).toHaveLength(4);

    const item: FuzzyResult = {
      word: "apple",
      score: 1,
      index: 0,
    };

    expect(res[0]).toMatchObject(item);
  });

  test("should return a list of results with 'apple' in the first place when using keys", () => {
    const search = fuzzySearch({
      data: [
        { name: "apple", color: "red", size: "medium" },
        { name: "watermelon", color: "green", size: "large" },
        { name: "lime", color: "lime", size: "small" },
        { name: "peach", color: "pink", size: "medium" },
      ],
      keys: ["name"],
    });

    const res = search("aple");
    expect(res).toHaveLength(4);

    const item: FuzzyResult = {
      word: {
        name: "apple",
        color: "red",
        size: "medium",
      },
      score: 1,
      index: 0,
    };

    expect(res[0]).toMatchObject(item);
  });
});

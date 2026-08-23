import { describe, expect, test } from "bun:test";
import { fuzzySearch } from "./fuzzy.js";
import type { FuzzyResult } from "./types.js";

describe("Fuzzy Search", () => {
  test("should return a list of results with 'apple' in the first position", () => {
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

  test("should return a list of results with 'apple' in the first position when using keys", () => {
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
        record: {
          name: "apple",
          color: "red",
          size: "medium",
        },
        key: "name",
      },
      score: 1,
      index: 0,
    };

    expect(res[0]).toMatchObject(item);
  });

  test("should return an empty result list when passing zero data", () => {
    const search = fuzzySearch({
      data: [] as string[],
    });

    const res = search("aple");
    expect(res).toHaveLength(0);

    const searchKey = fuzzySearch({
      data: [] as Record<string, string>[],
    });

    const resKey = searchKey("aple");
    expect(resKey).toHaveLength(0);
  });

  describe("Case Sensitive", () => {
    test("should support both capital and small letter when using plain strings as data", () => {
      const search = fuzzySearch({
        data: ["AppLe", "Watermelon", "LiMe", "PEACH"],
        caseSensitive: true,
      });

      const res = search("Aple");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: "AppLe",
        score: 2,
        index: 0,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should support both capital and small letter when using objects as data", () => {
      const search = fuzzySearch({
        data: [
          { name: "AppLe", color: "red", size: "medium" },
          { name: "Watermelon", color: "green", size: "large" },
          { name: "LiMe", color: "lime", size: "small" },
          { name: "PEACH", color: "pink", size: "medium" },
        ],
        keys: ["name"],
        caseSensitive: true,
      });

      const res = search("Aple");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: {
          record: {
            name: "AppLe",
            color: "red",
            size: "medium",
          },
          key: "name",
        },
        score: 2,
        index: 0,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should fold cases when 'caseSensitive' is disabled over a list of strings", () => {
      const search = fuzzySearch({
        data: ["AppLe", "Watermelon", "LiMe", "PEACH"],
      });

      const res = search("Aple");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: "AppLe",
        score: 1,
        index: 0,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should fold cases when 'caseSensitive' is disabled over a list objects", () => {
      const search = fuzzySearch({
        data: [
          { name: "AppLe", color: "red", size: "medium" },
          { name: "Watermelon", color: "green", size: "large" },
          { name: "LiMe", color: "lime", size: "small" },
          { name: "PEACH", color: "pink", size: "medium" },
        ],
        keys: ["name"],
      });

      const res = search("Aple");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: {
          record: {
            name: "AppLe",
            color: "red",
            size: "medium",
          },
          key: "name",
        },
        score: 1,
        index: 0,
      };

      expect(res[0]).toMatchObject(item);
    });
  });

  describe("Punctuation", () => {
    test("should ignore punctuation symbols when using a list of strings", () => {
      const search = fuzzySearch({
        data: ["apple!", "wat%rmelon?", "l.ime.", "PE<A>CH"],
        ignorePunctuation: true,
      });

      const res = search("ap/le");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: "apple!",
        score: 1,
        index: 0,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should ignore punctuation symbols when using a list of objects", () => {
      const search = fuzzySearch({
        data: [
          { name: "apple!", color: "red", size: "medium" },
          { name: "water?melon", color: "green", size: "large" },
          { name: "li//me", color: "lime", size: "small" },
          { name: "<peach>", color: "pink", size: "medium" },
        ],
        keys: ["name"],
        ignorePunctuation: true,
      });

      const res = search("pe;ch:");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: {
          record: {
            name: "<peach>",
            color: "pink",
            size: "medium",
          },
          key: "name",
        },
        score: 1,
        index: 3,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should include punctuation symbols when using a list of strings", () => {
      const search = fuzzySearch({
        data: ["apple!", "wat%rmelon?", "l.ime.", "PE<A>CH"],
      });

      const res = search("l!me.");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: "l.ime.",
        score: 2,
        index: 2,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should include punctuation symbols when using a list of objects", () => {
      const search = fuzzySearch({
        data: [
          { name: "apple!", color: "red", size: "medium" },
          { name: "water?melon", color: "green", size: "large" },
          { name: "li//me", color: "lime", size: "small" },
          { name: "<peach>", color: "pink", size: "medium" },
        ],
        keys: ["name"],
      });

      const res = search("pe;ch:");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: {
          record: {
            name: "<peach>",
            color: "pink",
            size: "medium",
          },
          key: "name",
        },
        score: 3,
        index: 3,
      };

      expect(res[0]).toMatchObject(item);
    });
  });

  describe("Diacritics", () => {
    test("should ignore diacritics when using plain strings as data", () => {
      const search = fuzzySearch({
        data: ["àpplé", "wàtèrmélòn", "limé", "peàçh"],
        ignoreDiacritics: true,
      });

      const res = search("wàtèrmelòn");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: "wàtèrmélòn",
        score: 0,
        index: 1,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should ignore diacritics when using objects as data", () => {
      const search = fuzzySearch({
        data: [
          { name: "àpplé", color: "red", size: "medium" },
          { name: "wàtèrmélòn", color: "green", size: "large" },
          { name: "limé", color: "lime", size: "small" },
          { name: "peàçh", color: "pink", size: "medium" },
        ],
        keys: ["name"],
        ignoreDiacritics: true,
      });

      const res = search("wàtèrmelòn");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: {
          record: {
            name: "wàtèrmélòn",
            color: "green",
            size: "large",
          },
          key: "name",
        },
        score: 0,
        index: 1,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should include diacritics when using plain strings as data", () => {
      const search = fuzzySearch({
        data: ["àpplé", "wàtèrmélòn", "limé", "peàçh"],
      });

      const res = search("wàtèrmelòn");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: "wàtèrmélòn",
        score: 1,
        index: 1,
      };

      expect(res[0]).toMatchObject(item);
    });

    test("should incluide diacritics when using objects as data", () => {
      const search = fuzzySearch({
        data: [
          { name: "àpplé", color: "red", size: "medium" },
          { name: "wàtèrmélòn", color: "green", size: "large" },
          { name: "limé", color: "lime", size: "small" },
          { name: "peàçh", color: "pink", size: "medium" },
        ],
        keys: ["name"],
      });

      const res = search("wàtèrmelòn");
      expect(res).toHaveLength(4);

      const item: FuzzyResult = {
        word: {
          record: {
            name: "wàtèrmélòn",
            color: "green",
            size: "large",
          },
          key: "name",
        },
        score: 1,
        index: 1,
      };

      expect(res[0]).toMatchObject(item);
    });
  });

  describe("Multiple keys", () => {
    test("should search over all the provided keys and give the best outcome", () => {
      const search = fuzzySearch({
        data: [
          { name: "apple", color: "red", size: "medium" },
          { name: "watermelon", color: "green", size: "large" },
          { name: "lime", color: "lime", size: "small" },
          { name: "peach", color: "pink", size: "medium" },
        ],
        keys: ["name", "size"],
      });

      const result = search("watermallon");
      expect(result).toHaveLength(4);

      const item: FuzzyResult = {
        word: {
          record: { name: "watermelon", color: "green", size: "large" },
          key: "name",
        },
        score: 2,
        index: 1,
      };

      expect(result[0]).toMatchObject(item);
    });
  });
});

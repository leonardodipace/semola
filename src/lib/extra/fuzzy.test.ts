import { describe, expect, test } from "bun:test";
import {
  foldCase,
  fuzzySearch,
  normalizeWeights,
  removeDiacritics,
  removePunctuation,
  retriveKeys,
  trasform,
} from "./fuzzy.js";

describe("Fuzzy Search", () => {
  test("should return a list of results with 'apple' in the first position", () => {
    const search = fuzzySearch({
      data: ["apple", "watermelon", "lime", "peach"],
    });

    const res = search("aple");

    expect(res).toHaveLength(4);
    expect(res[0]?.index).toBe(0);
    expect(res[0]?.word).toBe("apple");
  });

  test("should return an empty list in case input data is an empty list", () => {
    const search = fuzzySearch({
      data: [] as string[],
    });

    const res = search("aple");
    expect(res).toHaveLength(0);
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
    expect(res[0]?.index).toBe(0);
    expect(res[0]?.word).toMatchObject({
      record: {
        name: "apple",
        color: "red",
        size: "medium",
      },
      key: "name",
    });
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

  describe("Word Normalization", () => {
    test("should fold to lower case", () => {
      const applyFn = trasform(foldCase);
      const w = applyFn("The Quick Brown Fox Jumps Over The LAZY Dog");
      expect(w).toBe("the quick brown fox jumps over the lazy dog");
    });

    test("should remove punctuation symbols", () => {
      const applyFn = trasform(removePunctuation);
      const w = applyFn(
        "Th...e Quick(?) Brown F;ox, Jumps Ove//r The L#AZY Dog!",
      );

      expect(w).toBe("The Quick Brown Fox Jumps Over The LAZY Dog");
    });

    test("should remove diacritics", () => {
      const applyFn = trasform(removeDiacritics);

      expect(applyFn("é")).toBe("e");
      expect(applyFn("è")).toBe("e");
      expect(applyFn("à")).toBe("a");
      expect(applyFn("ç")).toBe("c");
      expect(applyFn("ù")).toBe("u");
      expect(applyFn("ò")).toBe("o");
    });

    test("should remove from entire words", () => {
      const applyFn = trasform(removeDiacritics);

      expect(applyFn("wàtèrmélòn")).toBe("watermelon");
      expect(applyFn("çàrròt")).toBe("carrot");
    });

    test("should compound changes", () => {
      const applyFn = trasform(removeDiacritics, foldCase, removePunctuation);

      const initial = "Th...è Quiçk(?) Brown F;ox, Jùmps Ove//r The L#àZY Dog!";
      const final = "the quick brown fox jumps over the lazy dog";

      expect(applyFn(initial)).toBe(final);
    });
  });

  describe("Case Sensitive", () => {
    test("should support both capital and small letter when using plain strings as data", () => {
      const search = fuzzySearch({
        data: ["AppLe", "Watermelon", "LiMe", "PEACH"],
        caseSensitive: true,
      });

      const res = search("Aple");

      expect(res).toHaveLength(4);
      expect(res[0]?.index).toBe(0);
      expect(res[0]?.word).toBe("AppLe");
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
      expect(res[0]?.index).toBe(0);
      expect(res[0]?.word).toMatchObject({
        record: {
          name: "AppLe",
          color: "red",
          size: "medium",
        },
        key: "name",
      });
    });

    test("should fold cases when 'caseSensitive' is disabled over a list of strings", () => {
      const search = fuzzySearch({
        data: ["AppLe", "Watermelon", "LiMe", "PEACH"],
      });

      const res = search("Aple");

      expect(res).toHaveLength(4);
      expect(res[0]?.index).toBe(0);
      expect(res[0]?.word).toBe("AppLe");
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

      expect(res[0]?.index).toBe(0);
      expect(res[0]?.word).toMatchObject({
        record: {
          name: "AppLe",
          color: "red",
          size: "medium",
        },
        key: "name",
      });
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
      expect(res[0]?.index).toBe(0);
      expect(res[0]?.word).toBe("apple!");
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
      expect(res[0]?.index).toBe(3);
      expect(res[0]?.word).toMatchObject({
        record: {
          name: "<peach>",
          color: "pink",
          size: "medium",
        },
        key: "name",
      });
    });

    test("should include punctuation symbols when using a list of strings", () => {
      const search = fuzzySearch({
        data: ["apple!", "wat%rmelon?", "l.ime.", "PE<A>CH"],
      });

      const res = search("l!me.");

      expect(res).toHaveLength(4);
      expect(res[0]?.index).toBe(2);
      expect(res[0]?.word).toBe("l.ime.");
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
      expect(res[0]?.index).toBe(3);
      expect(res[0]?.word).toMatchObject({
        record: {
          name: "<peach>",
          color: "pink",
          size: "medium",
        },
        key: "name",
      });
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
      expect(res[0]?.index).toBe(1);
      expect(res[0]?.word).toBe("wàtèrmélòn");
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
      expect(res[0]?.index).toBe(1);
      expect(res[0]?.word).toMatchObject({
        record: {
          name: "wàtèrmélòn",
          color: "green",
          size: "large",
        },
        key: "name",
      });
    });

    test("should include diacritics when using plain strings as data", () => {
      const search = fuzzySearch({
        data: ["àpplé", "wàtèrmélòn", "limé", "peàçh"],
      });

      const res = search("wàtèrmelòn");

      expect(res).toHaveLength(4);
      expect(res[0]?.index).toBe(1);
      expect(res[0]?.word).toBe("wàtèrmélòn");
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
      expect(res[0]?.index).toBe(1);
      expect(res[0]?.word).toMatchObject({
        record: {
          name: "wàtèrmélòn",
          color: "green",
          size: "large",
        },
        key: "name",
      });
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
      expect(result[0]?.index).toBe(1);
      expect(result[0]?.word).toMatchObject({
        record: { name: "watermelon", color: "green", size: "large" },
        key: "name",
      });
    });

    test("should retrive all keys when the 'keys' property was not provided", () => {
      const data = [
        { name: "apple", color: "red", size: "medium" },
        { name: "watermelon", color: "green", size: "large" },
        { name: "lime", color: "lime", size: "small" },
        { name: "peach", color: "pink", size: "medium" },
      ];

      const keys = retriveKeys([], data[0]);
      expect(keys).toHaveLength(3);

      expect(keys[0]).toBe("name");
      expect(keys[1]).toBe("color");
      expect(keys[2]).toBe("size");
    });

    test("should retrive only the provided keys", () => {
      const data = [
        { name: "apple", color: "red", size: "medium" },
        { name: "watermelon", color: "green", size: "large" },
        { name: "lime", color: "lime", size: "small" },
        { name: "peach", color: "pink", size: "medium" },
      ];

      const keys = retriveKeys(["color"], data[0]);
      expect(keys).toHaveLength(1);

      expect(keys[0]).toBe("color");
    });

    test("should return an empty list of keys when passing a list of strings instead of objects", () => {
      const data = ["red", "green", "blue"];

      const keys = retriveKeys(undefined, data[0]);
      expect(keys).toHaveLength(0);
    });

    test("should return an empty list of keys when passing 'undefined' as your data point", () => {
      expect(retriveKeys(undefined, undefined)).toHaveLength(0);
      expect(retriveKeys([], undefined)).toHaveLength(0);
    });
  });

  describe("Weights normalization", () => {
    const sumArr = (arr: number[]) => arr.reduce((acc, curr) => acc + curr);

    test("should produce a list with default weights", () => {
      const wFirst = normalizeWeights(3, undefined);
      expect(wFirst).toHaveLength(3);

      expect(wFirst[0]).toBe(1);
      expect(wFirst[1]).toBe(1);
      expect(wFirst[2]).toBe(1);

      const wSecond = normalizeWeights(3, []);
      expect(wSecond).toHaveLength(3);

      expect(wSecond[0]).toBe(1);
      expect(wSecond[1]).toBe(1);
      expect(wSecond[2]).toBe(1);

      expect(sumArr(wFirst)).toBe(3);
      expect(sumArr(wSecond)).toBe(3);
    });

    test("should normalize all weights and their sum should be equals to 1", () => {
      const original = [1, 3, 4];
      const weights = normalizeWeights(original.length, original);
      expect(weights).toHaveLength(original.length);

      const normalSum = sumArr(weights);
      expect(normalSum).toBeCloseTo(1);

      const originalSum = sumArr(original);

      expect(weights[0]).toBeCloseTo((original[0] ?? 1) / originalSum);
      expect(weights[1]).toBeCloseTo((original[1] ?? 1) / originalSum);
      expect(weights[2]).toBeCloseTo((original[2] ?? 1) / originalSum);
    });

    test("should handle missing weights as 1", () => {
      const original = [4];
      const weights = normalizeWeights(3, original);
      expect(weights).toHaveLength(3);

      const normalSum = sumArr(weights);
      expect(normalSum).toBeCloseTo(1);

      const originalSum = sumArr(original);

      expect(weights[0]).toBeCloseTo((original[0] ?? 1) / originalSum);
      expect(weights[1]).toBeCloseTo((original[1] ?? 1) / originalSum);
      expect(weights[2]).toBeCloseTo((original[2] ?? 1) / originalSum);
    });
  });
});

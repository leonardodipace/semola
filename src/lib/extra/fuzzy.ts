import type { FuzzyKeyType, FuzzyOptions, FuzzyResult } from "./types.js";

export const DEFAULT_TRESHOLD = 0.6;

type TransformationFnType = (word: string) => string;

export function foldCase(word: string) {
  return word.toLowerCase();
}

export function removePunctuation(word: string) {
  return word
    .replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g, "") // remove punctuation symbols
    .replace(/\s{2,}/g, " "); // remove extra spaces
}

export function removeDiacritics(word: string) {
  // remove all Unicode's code points that corrisponds to a diacritic
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function trasform(...transformFn: TransformationFnType[]) {
  const applyFn = (word: string) => {
    transformFn.forEach((fn) => {
      word = fn(word);
    });

    return word;
  };

  return applyFn;
}

export function createTrasformationList<
  FuzzyType extends string | Record<string, string>,
>(options: FuzzyOptions<FuzzyType>) {
  const { caseSensitive, ignorePunctuation, ignoreDiacritics } = options;
  const trasformation: TransformationFnType[] = [];

  if (!caseSensitive) trasformation.push(foldCase);
  if (ignorePunctuation) trasformation.push(removePunctuation);
  if (ignoreDiacritics) trasformation.push(removeDiacritics);

  return trasformation;
}

export function retriveKeys<FuzzyType extends string | Record<string, string>>(
  keys: FuzzyKeyType<FuzzyType>,
  item: FuzzyType | undefined,
) {
  if (keys && keys.length > 0) return keys;
  if (!item || typeof item === "string") return [] as string[];

  return Object.keys(item);
}

export function fuzzySearch<FuzzyType extends string | Record<string, string>>(
  options: FuzzyOptions<FuzzyType>,
) {
  const searchFn = (needle: string) => {
    const { data, keys } = options;
    if (data.length === 0) return [];

    const result: FuzzyResult[] = [];
    const actualKeys = retriveKeys(keys, data[0]);
    const trasformations = createTrasformationList<FuzzyType>(options);
    const applyFn = trasform(...trasformations);
    needle = applyFn(needle);

    for (let dataIdx = 0; dataIdx < data.length; dataIdx++) {
      const word = data[dataIdx];
      if (!word) return [];

      if (typeof word === "string") {
        const distance = levenshteinDistance(applyFn(word), needle);
        result.push({ word, score: distance, index: dataIdx });

        continue;
      }

      let minCost = Number.POSITIVE_INFINITY;
      let minCostKey = "";

      for (let kIdx = 0; kIdx < actualKeys.length; kIdx++) {
        const key = actualKeys[kIdx];
        if (!key) return [];

        const element = word[key];
        if (!element) return [];

        const distance = levenshteinDistance(applyFn(element), needle);
        if (distance < minCost) {
          minCost = distance;
          minCostKey = key;
        }
      }

      result.push({
        word: {
          record: word,
          key: minCostKey,
        },
        score: minCost,
        index: dataIdx,
      });
    }

    return result.sort((a, b) => a.score - b.score);
  };

  return searchFn;
}

export function levenshteinDistance(firstWord: string, secondWord: string) {
  if (firstWord.length < secondWord.length) {
    return levenshteinDistance(secondWord, firstWord);
  }

  if (secondWord.length === 0) return firstWord.length;
  let prevRow = Array.from({ length: secondWord.length + 1 }, (_, i) => i);

  for (let i = 0; i < firstWord.length; i++) {
    const firstChar = firstWord.charAt(i);
    const emptyCells = Array.from<number>({
      length: secondWord.length,
    }).fill(0);
    const currentRow = [i + 1, ...emptyCells];

    for (let j = 0; j < secondWord.length; j++) {
      const secondChar = secondWord.charAt(j);

      const nextOverPrev = prevRow[j + 1];
      const currentRowElem = currentRow[j];
      const prevRowElem = prevRow[j];

      if (nextOverPrev === undefined) return -1;
      if (currentRowElem === undefined) return -1;
      if (prevRowElem === undefined) return -1;

      const insertions = nextOverPrev + 1;
      const deletions = currentRowElem + 1;
      const substitutions = prevRowElem + (firstChar !== secondChar ? 1 : 0);

      currentRow[j + 1] = Math.min(insertions, deletions, substitutions);
    }

    prevRow = currentRow;
  }

  const cost = prevRow[prevRow.length - 1];
  if (cost === undefined) return -1;

  return cost;
}

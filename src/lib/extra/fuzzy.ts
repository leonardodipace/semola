import type {
  FuzzyKeyType,
  FuzzyOptions,
  FuzzyResult,
  TransformationFnType,
} from "./types.js";

export const DEFAULT_TRESHOLD = 0.6;

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

export function toSimilarity(
  needle: string,
  candidate: string,
  distance: number,
) {
  const maxLen = Math.max(needle.length, candidate.length);
  if (maxLen === 0) return 1;

  return 1 - distance / maxLen;
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
  if (keys && keys.length > 0) return keys; // user-provided keys
  if (!item || typeof item === "string") return [] as string[];

  return Object.keys(item);
}

export function normalizeWeights(
  dataAmount: number,
  weights: number[] | undefined,
) {
  if (!weights || weights.length === 0) {
    return Array.from({ length: dataAmount }, () => 1);
  }

  if (weights.length < dataAmount) {
    const missingWeights = Array.from(
      { length: dataAmount - weights.length },
      () => 1,
    );

    weights.push(...missingWeights);
  }

  const sum = weights.reduce((acc, curr) => acc + curr);
  const normalWeights = weights.map((w) => w / sum);

  return normalWeights;
}

export function fuzzySearch<FuzzyType extends string | Record<string, string>>(
  options: FuzzyOptions<FuzzyType>,
) {
  const { data, keys, weights } = options;

  const normalizedW = normalizeWeights(data.length, weights);
  const trasformations = createTrasformationList<FuzzyType>(options);
  const applyNormalizationFn = trasform(...trasformations);
  const actualKeys = data.length === 0 ? [] : retriveKeys(keys, data[0]);

  const searchFn = (needle: string) => {
    if (data.length === 0) return [];

    needle = applyNormalizationFn(needle);
    const result: FuzzyResult[] = [];

    for (let dataIdx = 0; dataIdx < data.length; dataIdx++) {
      const word = data[dataIdx];
      if (!word) return [];

      if (typeof word === "string") {
        const normalizedWord = applyNormalizationFn(word);
        const distance = levenshteinDistance(normalizedWord, needle);
        const score = toSimilarity(needle, normalizedWord, distance);
        result.push({ word, score, index: dataIdx });

        continue;
      }

      let minCost = Number.POSITIVE_INFINITY;
      let minCostKey = "";
      let candidateElement = "";

      for (let kIdx = 0; kIdx < actualKeys.length; kIdx++) {
        const key = actualKeys[kIdx];
        if (!key) return [];

        const element = word[key];
        if (!element) return [];

        const normalizedElem = applyNormalizationFn(element);
        const distance = levenshteinDistance(normalizedElem, needle);

        if (distance < minCost) {
          minCost = distance;
          minCostKey = key;
          candidateElement = normalizedElem;
        }
      }

      result.push({
        word: {
          record: word,
          key: minCostKey,
        },
        score: toSimilarity(needle, candidateElement, minCost),
        index: dataIdx,
      });
    }

    return result
      .map((v, rIdx) => {
        const w = normalizedW[rIdx];
        if (!w) return v;

        v.score *= w;
        return v;
      })
      .sort((a, b) => b.score - a.score);
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

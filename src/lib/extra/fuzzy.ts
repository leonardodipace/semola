import type {
  CachedDataPoint,
  CachedRecord,
  CachedString,
  FuzzyKeyType,
  FuzzyOptions,
  FuzzyResult,
  ToArray,
  TransformationFnType,
} from "./types.js";

export const DEFAULT_TRESHOLD = 0.6;
const NORMALIZATION_STRENGTH = 0.75;

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

function toNormalizedDistance(
  distance: number,
  firstSeq: string,
  secondSeq: string,
) {
  const max = Math.max(firstSeq.length, secondSeq.length);
  if (max === 0) return 0;

  return distance / max;
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
  keys: FuzzyKeyType<FuzzyType> | undefined,
  items: ToArray<FuzzyType>,
) {
  if (items.length === 0) return [];

  if (!keys) {
    const item = items[0];
    if (!item) return [];
    if (typeof item === "string") return [];

    return Object.keys(item);
  }

  if (keys.length > 0) return keys; // user-provided keys

  const item = items[0];
  if (!item) return [];
  if (typeof item === "string") return [];

  return Object.keys(item);
}

export function normalizeWeights(
  dataAmount: number,
  weights: number[] | undefined,
) {
  if (dataAmount === 0) return [];
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

export function normalizeDataPoint(
  data: string[] | Record<string, string>[],
  keys: string[],
  normFn: TransformationFnType,
) {
  const cache: CachedDataPoint = [];

  for (const word of data) {
    if (typeof word === "string") {
      const normWord = normFn(word);
      cache.push({
        type: "string",
        orignal: word,
        normalized: normWord,
        lenNorm: -1,
      });

      continue;
    }

    const newRecord: Record<string, string> = {};
    for (const key of keys) {
      newRecord[key] = normFn(word[key] ?? "");
    }

    cache.push({
      type: "record",
      orignal: word,
      normalized: newRecord,
      lenNorm: -1,
    });
  }

  return cache;
}

function calculateLegthNormalization(
  sequence: CachedString | CachedRecord,
  avgDocLen: number,
  keys: string[],
) {
  let docLen = 0;

  switch (sequence.type) {
    case "string": {
      docLen = tokenize(sequence.normalized).length;
      break;
    }
    case "record": {
      for (const key of keys) {
        docLen += tokenize(sequence.normalized[key] ?? "").length;
      }

      break;
    }
  }

  const lenNorm =
    1 - NORMALIZATION_STRENGTH + NORMALIZATION_STRENGTH * (docLen / avgDocLen);

  return lenNorm;
}

function saveLenNormalization(cache: CachedDataPoint, keys: string[]) {
  const avgDocLen = calculateDocAverageLength(cache, keys);

  cache = cache.map((entry) => {
    entry.lenNorm = calculateLegthNormalization(entry, avgDocLen, keys);
    return entry;
  });
}

function tokenize(sequence: string) {
  return sequence.split(/\s+/).filter(Boolean);
}

function calculateDocAverageLength(cache: CachedDataPoint, keys: string[]) {
  let sum = 0;

  for (const entry of cache) {
    if (entry.type === "string") {
      sum += tokenize(entry.normalized).length;
      continue;
    }

    for (const key of keys) {
      sum += tokenize(entry.normalized[key] ?? "").length;
    }
  }

  return sum / cache.length;
}

export function fuzzySearch<FuzzyType extends string | Record<string, string>>(
  options: FuzzyOptions<FuzzyType>,
) {
  const { data, keys, weights, threshold } = options;
  const scoreLimit = threshold === undefined ? DEFAULT_TRESHOLD : threshold;

  const trasformations = createTrasformationList<FuzzyType>(options);
  const applyNormalizationFn = trasform(...trasformations);

  const normalizedWeigths = normalizeWeights(data.length, weights);
  const actualKeys = retriveKeys(keys, data);
  const dataCache = normalizeDataPoint(data, actualKeys, applyNormalizationFn);
  saveLenNormalization(dataCache, actualKeys);

  const searchFn = (needle: string) => {
    if (data.length === 0) return [];

    needle = applyNormalizationFn(needle);
    const result: FuzzyResult[] = [];

    for (let dataIdx = 0; dataIdx < dataCache.length; dataIdx++) {
      const entry = dataCache[dataIdx];
      if (!entry) return [];

      if (entry.type === "string") {
        const rawDistance = levenshteinDistance(entry.normalized, needle);
        const normalizedDistance = toNormalizedDistance(
          rawDistance,
          entry.normalized,
          needle,
        );

        result.push({
          word: entry.orignal,
          score: normalizedDistance * entry.lenNorm,
          index: dataIdx,
        });

        continue;
      }

      let minRawDistance = Number.POSITIVE_INFINITY;
      let minCostKey = "";
      let candidateElement = "";

      for (let kIdx = 0; kIdx < actualKeys.length; kIdx++) {
        const key = actualKeys[kIdx];
        if (!key) return [];

        const element = entry.normalized[key];
        if (!element) return [];

        const rawDistance = levenshteinDistance(element, needle);
        if (rawDistance < minRawDistance) {
          minRawDistance = rawDistance;
          minCostKey = key;
          candidateElement = element;
        }
      }

      const normalizedDistance = toNormalizedDistance(
        minRawDistance,
        candidateElement,
        needle,
      );

      result.push({
        word: {
          record: entry.orignal,
          key: minCostKey,
        },
        score: normalizedDistance * entry.lenNorm,
        index: dataIdx,
      });
    }

    const finalResul = result.map((v, rIdx) => {
      const w = normalizedWeigths[rIdx];
      if (!w) return v;

      v.score *= w;
      return v;
    });

    const finalScores = finalResul.map((r) => r.score);
    const maxScore = Math.max(...finalScores);

    return finalResul
      .map((r) => {
        r.score = r.score / maxScore;
        return r;
      })
      .sort((a, b) => a.score - b.score)
      .filter((r) => r.score < scoreLimit);
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

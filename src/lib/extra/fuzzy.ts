import type { FuzzyOptions } from "./types.js";

export function fuzzySearch(options: FuzzyOptions) {}

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

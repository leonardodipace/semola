import type { Calculation } from "./types.js";

const TOP_COMMANDS_AMOUNT = 2;
const CUT_OFF = 0.6;

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

export function searchPossibleCommands(
  commands: string[],
  userCommand: string,
) {
  const calculations = commands
    .map<Calculation>((command) => {
      const distance = levenshteinDistance(command, userCommand);
      const maxLen = Math.max(command.length, userCommand.length);
      if (maxLen === 0) return { command, cost: 0 } satisfies Calculation;

      const ratio = 1 - distance / maxLen;

      return { command, cost: ratio } satisfies Calculation;
    })
    .filter((calc) => {
      const isGreaterThan = calc.cost > CUT_OFF;
      const isEqual = Math.abs(calc.cost - CUT_OFF) < Number.EPSILON;

      return isGreaterThan || isEqual;
    });

  return retrive(calculations);
}

function retrive(calculations: Calculation[]) {
  return calculations
    .sort((a, b) => b.cost - a.cost)
    .slice(0, TOP_COMMANDS_AMOUNT)
    .map((calc) => calc.command);
}

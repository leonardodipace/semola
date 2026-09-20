import { levenshteinDistance } from "../extra/fuzzy.js";
import type { Calculation } from "./types.js";

const TOP_COMMANDS_AMOUNT = 2;
const CUT_OFF = 0.6;

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

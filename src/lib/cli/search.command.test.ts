import { describe, expect, test } from "bun:test";
import {
  levenshteinDistance,
  searchPossibleCommands,
} from "./search.command.js";

describe("Search command", () => {
  const commands = ["create", "pull", "migrate", "audit", "push"];

  function sameArrays(arr1: string[], arr2: string[]) {
    return (
      arr1.every((_, index, it) => arr2[index] === it[index]) &&
      arr2.every((_, index, it) => arr1[index] === it[index])
    );
  }

  describe("Levenshtein distance", () => {
    test.each([
      { first: "kitten", second: "sitting", expected: 3 },
      { first: "sunday", second: "saturday", expected: 3 },
      { first: "orchestration", second: "container", expected: 10 },
      { first: "book", second: "back", expected: 2 },
      { first: "push", second: "posh", expected: 1 },
      { first: "book", second: "book", expected: 0 },
      { first: "", second: "test", expected: 4 },
      { first: "test", second: "", expected: 4 },
    ])("dist('$first', '$second') = $expected", (data) => {
      const { first, second, expected } = data;
      expect(levenshteinDistance(first, second)).toBe(expected);
    });
  });

  describe("Retrive commands", () => {
    test.each([
      {
        expectedCommands: ["migrate", "create"] as string[],
        userCommand: "grate",
        commandsAmount: 2,
      },
      {
        expectedCommands: ["pull"] as string[],
        userCommand: "puls",
        commandsAmount: 1,
      },
      {
        expectedCommands: ["audit"] as string[],
        userCommand: "oudit",
        commandsAmount: 1,
      },
      {
        expectedCommands: ["push"] as string[],
        userCommand: "puth",
        commandsAmount: 1,
      },
      {
        expectedCommands: [] as string[],
        userCommand: "mgrtat",
        commandsAmount: 0,
      },
    ])("should return a list of similar commands for '$userCommand'", (data) => {
      const { expectedCommands, userCommand, commandsAmount } = data;
      const possibleCommands = searchPossibleCommands(commands, userCommand);

      expect(possibleCommands).toHaveLength(commandsAmount);
      expect(sameArrays(expectedCommands, possibleCommands)).toBeTrue();
    });
  });
});

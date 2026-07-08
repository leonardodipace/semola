import { which } from "bun";
import { CliValidationError } from "./errors.js";
import type { OptionDef, ParsedArgv } from "./types.js";

const readFlagValue = (
  options: Record<string, string | true>,
  name: string,
  tokens: string[],
  index: number,
) => {
  const prev = tokens[index];
  let next = tokens[index + 1];

  if (prev !== undefined && next !== undefined) {
    const equalsIndex = prev.indexOf("=");
    if (equalsIndex === -1) {
      next = next.trim();
    }

    if (!next.startsWith("-")) {
      options[name] = next;
      return index + 2;
    }
  }

  options[name] = true;
  return index + 1;
};

const resolveOption = (
  lookup: Map<string, string>,
  key: string,
  errorMessage: string,
) => {
  const canonical = lookup.get(key);

  if (!canonical) {
    throw new CliValidationError(errorMessage);
  }

  return canonical;
};

export const parseArgv = (tokens: string[], optionDefs: OptionDef[]) => {
  const lookup = new Map<string, string>();

  for (const def of optionDefs) {
    lookup.set(def.name, def.name);

    for (const alias of def.aliases ?? []) {
      lookup.set(alias, def.name);
    }
  }

  const positional: string[] = [];
  const options: Record<string, string | true> = {};
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) break;

    const errMessage = `Unknown option: ${token}`;
    const equalsIndex = token.indexOf("=");
    const tokenKeyEnd = equalsIndex === -1 ? undefined : equalsIndex;

    if (token.charAt(0) === "-") {
      if (token.length < 2) {
        throw new CliValidationError(`Invalid option: ${token}`);
      }

      let tokenKeyStart = 1;
      if (token.charAt(1) === "-") {
        tokenKeyStart = 2;
      }

      const key = token.slice(tokenKeyStart, tokenKeyEnd);
      if (key.length === 1 && tokenKeyStart === 2) {
        throw new CliValidationError(`Invalid option: ${token}`);
      }

      const name = resolveOption(lookup, key, errMessage);

      if (equalsIndex !== -1) {
        options[name] = token.slice(equalsIndex + 1);
        index++;
        continue;
      }

      index = readFlagValue(options, name, tokens, index);
      continue;
    }

    positional.push(token);
    index++;
  }

  return { positional, options } satisfies ParsedArgv;
};

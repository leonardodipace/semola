import { CliValidationError } from "./errors.js";
import type { OptionDef, ParsedArgv } from "./types.js";

const readFlagValue = (
  options: Record<string, string | true>,
  name: string,
  tokens: string[],
  index: number,
) => {
  const next = tokens[index + 1];

  if (next !== undefined) {
    if (!next.startsWith("-")) {
      options[name] = next;
      return index + 2;
    }
  }

  options[name] = true;
  return index + 1;
};

const resolveOption = (lookup: Map<string, string>, key: string) => {
  const canonical = lookup.get(key);

  if (!canonical) {
    throw new CliValidationError(`Unknown option: --${key}`);
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
    if (token === "--") {
      positional.push(...tokens.slice(index + 1));
      break;
    }

    if (!token.startsWith("-")) {
      positional.push(token);
      index++;
      continue;
    }

    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      const key = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
      const name = resolveOption(lookup, key);

      if (equalsIndex !== -1) {
        options[name] = token.slice(equalsIndex + 1);
        index++;
        continue;
      }

      index = readFlagValue(options, name, tokens, index);
      continue;
    }

    if (token.length < 2) {
      throw new CliValidationError(`Invalid option: ${token}`);
    }

    const equalsIndex = token.indexOf("=");
    const key = token.slice(1, equalsIndex === -1 ? undefined : equalsIndex);
    const name = resolveOption(lookup, key);

    if (equalsIndex !== -1) {
      options[name] = token.slice(equalsIndex + 1);
      index++;
      continue;
    }

    index = readFlagValue(options, name, tokens, index);
  }

  return { positional, options } satisfies ParsedArgv;
};

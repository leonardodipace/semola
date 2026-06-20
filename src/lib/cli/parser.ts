import { CliValidationError } from "./errors.js";
import type { OptionDef, ParsedArgv } from "./types.js";

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

    if (token === undefined) {
      break;
    }

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

      if (equalsIndex !== -1) {
        const key = token.slice(2, equalsIndex);
        const value = token.slice(equalsIndex + 1);
        const name = resolveOption(lookup, key);

        options[name] = value;
        index++;
        continue;
      }

      const key = token.slice(2);
      const name = resolveOption(lookup, key);
      const next = tokens[index + 1];

      if (next !== undefined) {
        if (!next.startsWith("-")) {
          options[name] = next;
          index += 2;
          continue;
        }
      }

      options[name] = true;
      index++;
      continue;
    }

    if (token.length < 2) {
      throw new CliValidationError(`Invalid option: ${token}`);
    }

    const key = token.slice(1, 2);
    const attached = token.slice(2);
    const name = resolveOption(lookup, key);

    if (attached.length > 0) {
      options[name] = attached;
      index++;
      continue;
    }

    const next = tokens[index + 1];

    if (next !== undefined) {
      if (!next.startsWith("-")) {
        options[name] = next;
        index += 2;
        continue;
      }
    }

    options[name] = true;
    index++;
  }

  return { positional, options } satisfies ParsedArgv;
};

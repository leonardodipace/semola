import type { IntrospectedColumn } from "../../../types.js";
import { parseStringLiteral, stripWrappingParens } from "./literals.js";

function parseArrayToken(
  token: string,
  elementKind: NonNullable<IntrospectedColumn["arrayElementKind"]>,
) {
  let value = stripWrappingParens(token.trim());
  const castIndex = value.indexOf("::");

  if (castIndex > -1) {
    value = value.slice(0, castIndex).trim();
  }

  const parsedString = parseStringLiteral(value);

  if (parsedString !== null) {
    return parsedString;
  }

  if (elementKind === "number") {
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return Number(value);
    }

    return null;
  }

  if (elementKind === "boolean") {
    const lower = value.toLowerCase();

    if (lower === "true" || value === "1") {
      return true;
    }

    if (lower === "false" || value === "0") {
      return false;
    }

    return null;
  }

  return value;
}

export function parseArrayDefaultValues(
  rawDefault: string,
  elementKind: NonNullable<IntrospectedColumn["arrayElementKind"]>,
) {
  const trimmed = rawDefault.trim();

  if (!trimmed.startsWith("ARRAY[")) {
    return null;
  }

  const startIndex = trimmed.indexOf("[");
  let endIndex = -1;
  let depth = 0;
  let inString = false;

  for (let index = startIndex; index < trimmed.length; index++) {
    const char = trimmed[index];

    if (char === "'") {
      if (inString && trimmed[index + 1] === "'") {
        index++;
        continue;
      }

      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "[") {
      depth++;
      continue;
    }

    if (char === "]") {
      depth--;

      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  const inner = trimmed.slice(startIndex + 1, endIndex);

  if (inner.trim().length === 0) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let tokenInString = false;
  let index = 0;

  while (index < inner.length) {
    const char = inner[index];

    if (char === "'") {
      if (tokenInString && inner[index + 1] === "'") {
        current += "''";
        index += 2;
        continue;
      }

      tokenInString = !tokenInString;
      current += char;
      index++;
      continue;
    }

    if (char === "," && !tokenInString) {
      tokens.push(current);
      current = "";
      index++;
      continue;
    }

    current += char;
    index++;
  }

  tokens.push(current);

  const out: Array<string | number | boolean> = [];

  for (const token of tokens) {
    const parsed = parseArrayToken(token, elementKind);

    if (parsed === null) {
      return null;
    }

    if (
      typeof parsed !== "string" &&
      typeof parsed !== "number" &&
      typeof parsed !== "boolean"
    ) {
      return null;
    }

    out.push(parsed);
  }

  return out;
}

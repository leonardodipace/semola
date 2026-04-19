function coerceUnquotedToken(token: string) {
  const trimmed = token.trim();

  if (trimmed === "NULL") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const lower = trimmed.toLowerCase();

  if (lower === "true") {
    return true;
  }

  if (lower === "false") {
    return false;
  }

  return trimmed;
}

export function parsePostgresArrayLiteral(value: string) {
  const trimmed = value.trim();

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  const inner = trimmed.slice(1, -1);

  if (inner.length === 0) {
    return [];
  }

  const out: unknown[] = [];
  let token = "";
  let index = 0;
  let inQuotes = false;
  let tokenWasQuoted = false;

  while (index < inner.length) {
    const char = inner[index];

    if (inQuotes) {
      if (char === "\\") {
        const next = inner[index + 1];

        if (next) {
          token += next;
          index += 2;
          continue;
        }
      }

      if (char === '"') {
        inQuotes = false;
        index++;
        continue;
      }

      token += char;
      index++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      tokenWasQuoted = true;
      index++;
      continue;
    }

    if (char === ",") {
      if (tokenWasQuoted) {
        out.push(token);
      } else {
        out.push(coerceUnquotedToken(token));
      }

      token = "";
      tokenWasQuoted = false;
      index++;
      continue;
    }

    token += char;
    index++;
  }

  if (inQuotes) {
    return null;
  }

  if (tokenWasQuoted) {
    out.push(token);
  } else {
    out.push(coerceUnquotedToken(token));
  }

  return out;
}

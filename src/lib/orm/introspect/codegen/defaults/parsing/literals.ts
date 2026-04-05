function stripWrappingParens(value: string) {
  const trimmed = value.trim();

  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return trimmed;
  }

  return trimmed.slice(1, -1).trim();
}

function parseStringLiteral(input: string) {
  const trimmed = input.trim();

  if (!trimmed.startsWith("'")) {
    return null;
  }

  let out = "";
  let index = 1;

  while (index < trimmed.length) {
    const char = trimmed[index];

    if (char === "'") {
      const next = trimmed[index + 1];

      if (next === "'") {
        out += "'";
        index += 2;
        continue;
      }

      const rest = trimmed.slice(index + 1).trim();

      if (rest.length === 0 || rest.startsWith("::")) {
        return out;
      }

      return null;
    }

    out += char;
    index++;
  }

  return null;
}

export { parseStringLiteral, stripWrappingParens };

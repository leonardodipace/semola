export function splitStatements(sqlText: string) {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag: string | null = null;

  function findDollarQuoteTag(start: number) {
    if (sqlText[start] !== "$") {
      return null;
    }

    for (let end = start + 1; end < sqlText.length; end++) {
      if (sqlText[end] !== "$") {
        continue;
      }

      const tag = sqlText.slice(start, end + 1);

      if (/^\$[A-Za-z_][A-Za-z0-9_]*\$$/.test(tag) || tag === "$$") {
        return {
          tag,
          end,
        };
      }

      return null;
    }

    return null;
  }

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    const next = sqlText[i + 1] ?? "";

    if (inLineComment) {
      current += ch;

      if (ch === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      current += ch;

      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }

      continue;
    }

    if (dollarQuoteTag) {
      if (sqlText.startsWith(dollarQuoteTag, i)) {
        current += dollarQuoteTag;
        i += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
        continue;
      }

      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        current += "--";
        i++;
        inLineComment = true;
        continue;
      }

      if (ch === "/" && next === "*") {
        current += "/*";
        i++;
        inBlockComment = true;
        continue;
      }

      if (ch === "$") {
        const dollarQuote = findDollarQuoteTag(i);

        if (dollarQuote) {
          current += dollarQuote.tag;
          i = dollarQuote.end;
          dollarQuoteTag = dollarQuote.tag;
          continue;
        }
      }
    }

    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        current += "''";
        i++;
        continue;
      }

      inSingle = !inSingle;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    }

    if (ch === ";" && !inSingle && !inDouble) {
      const stmt = current.trim();

      if (stmt.length > 0) {
        statements.push(stmt);
      }

      current = "";
      continue;
    }

    current += ch;
  }

  const last = current.trim();

  if (last.length > 0) {
    statements.push(last);
  }

  return statements;
}

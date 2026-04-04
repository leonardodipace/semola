export function splitStatements(sqlText: string) {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];

    if (ch === "'" && !inDouble) {
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

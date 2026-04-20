import type { SQL, TransactionSQL } from "bun";
import { splitStatements } from "./files.js";

export async function runStatements(
  runner: SQL | TransactionSQL,
  sqlText: string,
) {
  const statements = splitStatements(sqlText);

  for (const statement of statements) {
    await runner`${runner.unsafe(statement)}`;
  }
}

function normalizeStatementForTransactionCheck(statement: string) {
  let current = statement;

  while (true) {
    const withoutLeadingWhitespace = current.trimStart();

    if (withoutLeadingWhitespace.startsWith("--")) {
      const newlineIndex = withoutLeadingWhitespace.indexOf("\n");

      if (newlineIndex === -1) {
        return "";
      }

      current = withoutLeadingWhitespace.slice(newlineIndex + 1);
      continue;
    }

    if (withoutLeadingWhitespace.startsWith("/*")) {
      const endCommentIndex = withoutLeadingWhitespace.indexOf("*/");

      if (endCommentIndex === -1) {
        return "";
      }

      current = withoutLeadingWhitespace.slice(endCommentIndex + 2);
      continue;
    }

    return withoutLeadingWhitespace.trim().toUpperCase();
  }
}

export function hasExplicitTransaction(sqlText: string) {
  const statements = splitStatements(sqlText);

  for (const statement of statements) {
    const normalized = normalizeStatementForTransactionCheck(statement);

    if (normalized.startsWith("BEGIN")) {
      return true;
    }

    if (normalized.startsWith("START TRANSACTION")) {
      return true;
    }

    if (normalized.startsWith("COMMIT")) {
      return true;
    }

    if (normalized.startsWith("ROLLBACK")) {
      return true;
    }
  }

  return false;
}

export async function runMigrationSql(
  sql: SQL,
  sqlText: string,
  transactional: boolean,
) {
  if (transactional && !hasExplicitTransaction(sqlText)) {
    await sql.begin(async (tx) => {
      await runStatements(tx, sqlText);
    });
    return;
  }

  await runStatements(sql, sqlText);
}

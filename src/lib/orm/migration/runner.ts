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

export function hasExplicitTransaction(sqlText: string) {
  const statements = splitStatements(sqlText);

  for (const statement of statements) {
    const normalized = statement.trim().toUpperCase();

    if (normalized === "BEGIN") {
      return true;
    }

    if (normalized.startsWith("BEGIN ")) {
      return true;
    }

    if (normalized === "START TRANSACTION") {
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

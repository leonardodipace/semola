import type { SQL } from "bun";

const migrationTableName = "_semola_migrations";

type AppliedMigration = {
  id: string;
  name: string;
  directoryName: string;
  appliedAt: string;
};

function readString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  if (!value) {
    return null;
  }

  return value;
}

function parseAppliedMigrationRow(row: unknown) {
  if (!row) {
    return null;
  }

  if (typeof row !== "object") {
    return null;
  }

  const id = readString(Reflect.get(row, "migration_id"));
  const name = readString(Reflect.get(row, "migration_name"));
  const directoryName = readString(Reflect.get(row, "directory_name"));
  const appliedAt = readString(Reflect.get(row, "applied_at"));

  if (!id) {
    return null;
  }

  if (!name) {
    return null;
  }

  if (!directoryName) {
    return null;
  }

  if (!appliedAt) {
    return null;
  }

  return {
    id,
    name,
    directoryName,
    appliedAt,
  } satisfies AppliedMigration;
}

export function getMigrationTableName() {
  return migrationTableName;
}

export async function ensureMigrationStateTable(sql: SQL) {
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${migrationTableName} (` +
      "directory_name TEXT PRIMARY KEY," +
      "migration_id TEXT NOT NULL," +
      "migration_name TEXT NOT NULL," +
      "applied_at TEXT NOT NULL" +
      ")",
  );
}

export async function listAppliedMigrations(sql: SQL) {
  const rows = await sql.unsafe(
    `SELECT migration_id, migration_name, directory_name, applied_at ` +
      `FROM ${migrationTableName} ` +
      "ORDER BY applied_at ASC, directory_name ASC",
  );

  if (!Array.isArray(rows)) {
    return [];
  }

  const applied: AppliedMigration[] = [];

  for (const row of rows) {
    const parsed = parseAppliedMigrationRow(row);

    if (!parsed) {
      continue;
    }

    applied.push(parsed);
  }

  return applied;
}

export async function readLatestAppliedMigration(sql: SQL) {
  const rows = await sql.unsafe(
    `SELECT migration_id, migration_name, directory_name, applied_at ` +
      `FROM ${migrationTableName} ` +
      "ORDER BY applied_at DESC, directory_name DESC LIMIT 1",
  );

  if (!Array.isArray(rows)) {
    return null;
  }

  const firstRow = rows[0];
  const parsed = parseAppliedMigrationRow(firstRow);

  if (!parsed) {
    return null;
  }

  return parsed;
}

export async function markAppliedMigration(
  sql: SQL,
  migration: {
    id: string;
    name: string;
    directoryName: string;
  },
) {
  await sql.unsafe(
    `INSERT INTO ${migrationTableName} (` +
      "directory_name, migration_id, migration_name, applied_at" +
      ") VALUES (?, ?, ?, ?)",
    [
      migration.directoryName,
      migration.id,
      migration.name,
      new Date().toISOString(),
    ],
  );
}

export async function unmarkAppliedMigration(
  sql: SQL,
  migration: {
    directoryName: string;
  },
) {
  await sql.unsafe(
    `DELETE FROM ${migrationTableName} WHERE directory_name = ?`,
    [migration.directoryName],
  );
}

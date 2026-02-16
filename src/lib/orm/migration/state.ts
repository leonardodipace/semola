import type { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
import { toSqlIdentifier } from "./sql.js";
import type { AppliedMigration } from "./types.js";

const asRecord = (value: unknown) => {
  if (typeof value === "object" && value !== null) {
    return value;
  }
  return null;
};

const readString = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
};

export const ensureMigrationsTable = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
) => {
  const safeTableName = toSqlIdentifier(tableName, "table name");

  await orm.sql`
    CREATE TABLE IF NOT EXISTS ${orm.sql(safeTableName)} (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `;
};

export const getAppliedMigrations = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
) => {
  const safeTableName = toSqlIdentifier(tableName, "table name");
  const rows = await orm.sql`
    SELECT version, name, applied_at
    FROM ${orm.sql(safeTableName)}
    ORDER BY version ASC
  `;

  const list: AppliedMigration[] = [];

  if (!Array.isArray(rows)) {
    return list;
  }

  for (const row of rows) {
    const record = asRecord(row);
    if (!record) {
      continue;
    }

    const version = readString(Reflect.get(record, "version"));
    const name = readString(Reflect.get(record, "name"));
    const appliedAt = readString(
      Reflect.get(record, "applied_at") ?? Reflect.get(record, "appliedAt"),
    );

    if (version.length === 0 || name.length === 0) {
      continue;
    }

    list.push({ version, name, appliedAt });
  }

  return list;
};

export const recordMigration = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
  version: string,
  name: string,
) => {
  const safeTableName = toSqlIdentifier(tableName, "table name");
  const appliedAt = new Date().toISOString();
  await orm.sql`
    INSERT INTO ${orm.sql(safeTableName)} (version, name, applied_at)
    VALUES (${version}, ${name}, ${appliedAt})
  `;
};

export const removeMigration = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
  version: string,
) => {
  const safeTableName = toSqlIdentifier(tableName, "table name");

  await orm.sql`
    DELETE FROM ${orm.sql(safeTableName)}
    WHERE version = ${version}
  `;
};

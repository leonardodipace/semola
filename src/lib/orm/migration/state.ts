import type { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
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
  const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`;
  await orm.sql.unsafe(sql);
};

export const getAppliedMigrations = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
) => {
  const sql = `SELECT version, name, applied_at FROM ${tableName} ORDER BY version ASC`;
  const rows = await orm.sql.unsafe(sql);

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
  const appliedAt = new Date().toISOString();
  await orm.sql.unsafe(
    `INSERT INTO ${tableName} (version, name, applied_at) VALUES ('${version.replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', '${appliedAt}')`,
  );
};

export const removeMigration = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
  version: string,
) => {
  await orm.sql.unsafe(
    `DELETE FROM ${tableName} WHERE version = '${version.replace(/'/g, "''")}'`,
  );
};

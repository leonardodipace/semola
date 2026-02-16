import { err, ok } from "../../errors/index.js";
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
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return err("ValidationError", error.message);
  }

  try {
    await orm.sql`
      CREATE TABLE IF NOT EXISTS ${orm.sql(safeTableName)} (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `;
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err("InternalServerError", message);
  }
};

export const getAppliedMigrations = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
) => {
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return [error, []] as const;
  }

  try {
    const rows = await orm.sql`
      SELECT version, name, applied_at
      FROM ${orm.sql(safeTableName)}
      ORDER BY version ASC
    `;

    const list: AppliedMigration[] = [];

    if (!Array.isArray(rows)) {
      return [null, list] as const;
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

    return [null, list] as const;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [err("InternalServerError", message)[0], []] as const;
  }
};

export const recordMigration = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
  version: string,
  name: string,
) => {
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return [error, null] as const;
  }

  try {
    const appliedAt = new Date().toISOString();
    await orm.sql`
      INSERT INTO ${orm.sql(safeTableName)} (version, name, applied_at)
      VALUES (${version}, ${name}, ${appliedAt})
    `;
    return [null, true] as const;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [err("InternalServerError", message)[0], null] as const;
  }
};

export const removeMigration = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
  version: string,
) => {
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return [error, null] as const;
  }

  try {
    await orm.sql`
      DELETE FROM ${orm.sql(safeTableName)}
      WHERE version = ${version}
    `;
    return [null, true] as const;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [err("InternalServerError", message)[0], null] as const;
  }
};

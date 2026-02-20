import { err, mightThrow, ok } from "../../errors/index.js";
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

  const [createError] = await mightThrow(orm.sql`
      CREATE TABLE IF NOT EXISTS ${orm.sql(safeTableName)} (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
  if (createError) {
    const message =
      createError instanceof Error ? createError.message : String(createError);
    return err("InternalServerError", message);
  }

  return ok(undefined);
};

export const getAppliedMigrations = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
) => {
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return err("ValidationError", error.message);
  }

  const [queryError, rows] = await mightThrow(orm.sql`
      SELECT version, name, applied_at
      FROM ${orm.sql(safeTableName)}
      ORDER BY version ASC
    `);
  if (queryError) {
    const message =
      queryError instanceof Error ? queryError.message : String(queryError);
    return err("InternalServerError", message);
  }

  const list: AppliedMigration[] = [];

  if (!Array.isArray(rows)) {
    return ok(list);
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

  return ok(list);
};

export const recordMigration = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
  version: string,
  name: string,
  sqlExecutor?: Bun.SQL,
) => {
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return err("ValidationError", error.message);
  }

  const sql = sqlExecutor ?? orm.sql;
  const appliedAt = new Date().toISOString();
  const [insertError] = await mightThrow(sql`
      INSERT INTO ${sql(safeTableName)} (version, name, applied_at)
      VALUES (${version}, ${name}, ${appliedAt})
    `);
  if (insertError) {
    const message =
      insertError instanceof Error ? insertError.message : String(insertError);
    return err("InternalServerError", message);
  }

  return ok(true);
};

export const removeMigration = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
  version: string,
  sqlExecutor?: Bun.SQL,
) => {
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return err("ValidationError", error.message);
  }

  const sql = sqlExecutor ?? orm.sql;
  const [deleteError] = await mightThrow(sql`
      DELETE FROM ${sql(safeTableName)}
      WHERE version = ${version}
    `);
  if (deleteError) {
    const message =
      deleteError instanceof Error ? deleteError.message : String(deleteError);
    return err("InternalServerError", message);
  }

  return ok(true);
};

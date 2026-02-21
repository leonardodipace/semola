import { err, mightThrow, ok } from "../../errors/index.js";
import type { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
import { toSqlIdentifier } from "./sql.js";
import type { AppliedMigration } from "./types.js";

const toInternalErr = (error: unknown) =>
  err(
    "InternalServerError",
    error instanceof Error ? error.message : String(error),
  );

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
    return toInternalErr(createError);
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

  const [queryError, rows] = await mightThrow(
    orm.sql<AppliedMigration[]>`
      SELECT version, name, applied_at AS "appliedAt"
      FROM ${orm.sql(safeTableName)}
      ORDER BY version ASC
    `,
  );
  if (queryError) {
    return toInternalErr(queryError);
  }

  return ok(rows ?? []);
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
    return toInternalErr(insertError);
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
    return toInternalErr(deleteError);
  }

  return ok(true);
};

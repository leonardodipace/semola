import { err, mightThrow, ok } from "../../errors/index.js";
import type { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
import { toSqlIdentifier } from "./sql.js";

const readColumnName = (row: unknown) => {
  if (typeof row !== "object" || row === null) {
    return null;
  }

  const name =
    Reflect.get(row, "name") ??
    Reflect.get(row, "column_name") ??
    Reflect.get(row, "COLUMN_NAME");

  if (typeof name === "string") {
    return name;
  }

  return null;
};

const queryColumns = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
) => {
  // Validate table name to prevent SQL injection
  const [error, safeTableName] = toSqlIdentifier(tableName, "table name");
  if (error) {
    return err("ValidationError", error.message);
  }

  const dialect = orm.getDialectName();

  if (dialect === "sqlite") {
    const [queryError, rows] = await mightThrow(
      orm.sql`
      SELECT name
      FROM pragma_table_info(${safeTableName})
    `,
    );
    if (queryError) {
      return err(
        "InternalServerError",
        queryError instanceof Error ? queryError.message : String(queryError),
      );
    }

    return ok(rows ?? []);
  }

  if (dialect === "postgres") {
    const [queryError, rows] = await mightThrow(
      orm.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
      AND table_name = ${safeTableName}
    `,
    );
    if (queryError) {
      return err(
        "InternalServerError",
        queryError instanceof Error ? queryError.message : String(queryError),
      );
    }

    return ok(rows ?? []);
  }

  const [queryError, rows] = await mightThrow(
    orm.sql`
    SELECT COLUMN_NAME AS column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = ${safeTableName}
  `,
  );
  if (queryError) {
    return err(
      "InternalServerError",
      queryError instanceof Error ? queryError.message : String(queryError),
    );
  }

  return ok(rows ?? []);
};

export const introspectSchema = async (
  orm: Orm<Record<string, Table>>,
  tableNames: string[],
) => {
  const schema = new Map<string, Set<string>>();

  for (const tableName of tableNames) {
    const [error, rows] = await queryColumns(orm, tableName);
    if (error) {
      return err(error.type, error.message);
    }

    const columns = new Set<string>();

    if (Array.isArray(rows)) {
      for (const row of rows) {
        const name = readColumnName(row);
        if (name) {
          columns.add(name);
        }
      }
    }

    schema.set(tableName, columns);
  }

  return ok(schema);
};

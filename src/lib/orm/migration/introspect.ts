import type { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";

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

const escapeLiteral = (value: string) => {
  return value.replace(/'/g, "''");
};

const queryColumns = async (
  orm: Orm<Record<string, Table>>,
  tableName: string,
) => {
  const dialect = orm.getDialectName();
  const safeTableName = escapeLiteral(tableName);

  if (dialect === "sqlite") {
    return orm.sql.unsafe(`PRAGMA table_info('${safeTableName}')`);
  }

  if (dialect === "postgres") {
    return orm.sql.unsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${safeTableName}'`,
    );
  }

  return orm.sql.unsafe(
    `SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${safeTableName}'`,
  );
};

export const introspectSchema = async (
  orm: Orm<Record<string, Table>>,
  tableNames: string[],
) => {
  const schema = new Map<string, Set<string>>();

  for (const tableName of tableNames) {
    const rows = await queryColumns(orm, tableName);
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

  return schema;
};

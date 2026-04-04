import type { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
import { toErrMsg } from "./shared.js";
import { mapSqliteColumns } from "./sqlite/mapping.js";
import type { IntrospectedTable } from "./types.js";

export async function introspectSqlite(sql: SQL) {
  const [tablesErr, tableRows] = await mightThrow(
    sql`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `.values() as Promise<[string][]>,
  );

  if (tablesErr) {
    return err(
      "IntrospectError",
      `Failed to list tables: ${toErrMsg(tablesErr)}`,
    );
  }

  const tableNames = (tableRows ?? []).map((row) => row[0]);
  const tables: IntrospectedTable[] = [];

  for (const tableName of tableNames) {
    const [colErr, colRows] = await mightThrow(
      sql`PRAGMA table_info(${sql.unsafe(tableName)})`.values() as Promise<
        [number, string, string, number, string | null, number][]
      >,
    );

    if (colErr) {
      return err(
        "IntrospectError",
        `Failed to get table_info for ${tableName}: ${toErrMsg(colErr)}`,
      );
    }

    const [fkErr, fkRows] = await mightThrow(
      sql`PRAGMA foreign_key_list(${sql.unsafe(tableName)})`.values() as Promise<
        [number, number, string, string, string, string, string, string][]
      >,
    );

    if (fkErr) {
      return err(
        "IntrospectError",
        `Failed to get foreign_key_list for ${tableName}: ${toErrMsg(fkErr)}`,
      );
    }

    const columns = mapSqliteColumns(colRows ?? [], fkRows ?? []);

    tables.push({ name: tableName, columns });
  }

  return ok(tables);
}

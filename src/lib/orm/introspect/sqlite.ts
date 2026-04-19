import type { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
import { sqliteDialectAdapter } from "../dialect/sqlite.js";
import { toErrMsg } from "./shared.js";
import { mapSqliteColumns } from "./sqlite/mapping.js";
import type { IntrospectedTable } from "./types.js";

export async function introspectSqlite(sql: SQL) {
  const [tablesErr, tableRows] = await mightThrow<[string][]>(
    sql`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `.values(),
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
    const quotedTableName = sqliteDialectAdapter.quoteIdentifier(tableName);

    const [colErr, colRows] = await mightThrow<
      [number, string, string, number, string | null, number][]
    >(sql`PRAGMA table_info(${sql.unsafe(quotedTableName)})`.values());

    if (colErr) {
      return err(
        "IntrospectError",
        `Failed to get table_info for ${tableName}: ${toErrMsg(colErr)}`,
      );
    }

    const [fkErr, fkRows] = await mightThrow<
      [number, number, string, string, string, string, string, string][]
    >(sql`PRAGMA foreign_key_list(${sql.unsafe(quotedTableName)})`.values());

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

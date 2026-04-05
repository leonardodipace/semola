import type { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
import { mapMysqlColumns } from "./mysql/mapping.js";
import { toErrMsg } from "./shared.js";
import type { IntrospectedTable } from "./types.js";

export async function introspectMysql(sql: SQL, schema: string) {
  const [tablesErr, tableRows] = await mightThrow(
    sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schema}
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
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
      sql`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          column_key,
          extra
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND table_name = ${tableName}
        ORDER BY ordinal_position
      `.values() as Promise<
        [string, string, string, string | null, string, string][]
      >,
    );

    if (colErr) {
      return err(
        "IntrospectError",
        `Failed to list columns for ${tableName}: ${toErrMsg(colErr)}`,
      );
    }

    const [fkErr, fkRows] = await mightThrow(
      sql`
        SELECT
          kcu.column_name,
          kcu.referenced_table_name,
          kcu.referenced_column_name,
          rc.delete_rule
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.referential_constraints rc
          ON kcu.constraint_name = rc.constraint_name
          AND kcu.constraint_schema = rc.constraint_schema
        WHERE kcu.table_schema = ${schema}
          AND kcu.table_name = ${tableName}
          AND kcu.referenced_table_name IS NOT NULL
      `.values() as Promise<[string, string, string, string][]>,
    );

    if (fkErr) {
      return err(
        "IntrospectError",
        `Failed to list foreign keys for ${tableName}: ${toErrMsg(fkErr)}`,
      );
    }

    const columns = mapMysqlColumns(colRows ?? [], fkRows ?? []);

    tables.push({ name: tableName, columns });
  }

  return ok(tables);
}

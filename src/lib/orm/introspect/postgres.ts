import type { SQL } from "bun";
import { err, ok } from "../../errors/index.js";
import { toErrMsg } from "./postgres/errors.js";
import { buildEnumMap, mapColumns } from "./postgres/mapping.js";
import {
  getColumnRows,
  getConstraintRows,
  getEnumRows,
  getForeignKeyRows,
  getTableRows,
} from "./postgres/queries.js";
import type { IntrospectedTable } from "./types.js";

export async function introspectPostgres(sql: SQL, schema = "public") {
  const [enumErr, enumRows] = await getEnumRows(sql, schema);

  if (enumErr) {
    return err("IntrospectError", `Failed to list enums: ${toErrMsg(enumErr)}`);
  }

  const enumMap = buildEnumMap(enumRows ?? []);

  const [tablesErr, tableRows] = await getTableRows(sql, schema);

  if (tablesErr) {
    return err(
      "IntrospectError",
      `Failed to list tables: ${toErrMsg(tablesErr)}`,
    );
  }

  const tableNames = (tableRows ?? []).map((row) => row[0]);
  const tables: IntrospectedTable[] = [];

  for (const tableName of tableNames) {
    const [colErr, colRows] = await getColumnRows(sql, schema, tableName);

    if (colErr) {
      return err(
        "IntrospectError",
        `Failed to list columns for ${tableName}: ${toErrMsg(colErr)}`,
      );
    }

    const [constraintErr, constraintRows] = await getConstraintRows(
      sql,
      schema,
      tableName,
    );

    if (constraintErr) {
      return err(
        "IntrospectError",
        `Failed to list constraints for ${tableName}: ${toErrMsg(constraintErr)}`,
      );
    }

    const [fkErr, fkRows] = await getForeignKeyRows(sql, schema, tableName);

    if (fkErr) {
      return err(
        "IntrospectError",
        `Failed to list foreign keys for ${tableName}: ${toErrMsg(fkErr)}`,
      );
    }

    const columns = mapColumns(
      colRows ?? [],
      constraintRows ?? [],
      fkRows ?? [],
      enumMap,
    );

    tables.push({ name: tableName, columns });
  }

  return ok(tables);
}

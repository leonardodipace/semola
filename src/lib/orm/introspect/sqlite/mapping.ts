import type { ColumnKind } from "../../types.js";
import { toOnDelete } from "../shared.js";
import type { IntrospectedColumn } from "../types.js";

function mapDbType(dbType: string): {
  kind: ColumnKind;
  unknown: string | null;
} {
  const t = dbType
    .toUpperCase()
    .replace(/\(.*\)/, "")
    .trim();

  if (
    t === "TEXT" ||
    t === "VARCHAR" ||
    t === "CHAR" ||
    t === "CLOB" ||
    t === "BLOB" ||
    t === ""
  ) {
    return { kind: "string", unknown: null };
  }

  if (
    t === "INTEGER" ||
    t === "INT" ||
    t === "TINYINT" ||
    t === "SMALLINT" ||
    t === "MEDIUMINT" ||
    t === "BIGINT" ||
    t === "UNSIGNED BIG INT" ||
    t === "INT2" ||
    t === "INT8" ||
    t === "NUMERIC" ||
    t === "DECIMAL" ||
    t === "REAL" ||
    t === "DOUBLE" ||
    t === "DOUBLE PRECISION" ||
    t === "FLOAT"
  ) {
    return { kind: "number", unknown: null };
  }

  if (t === "BOOLEAN" || t === "BOOL") {
    return { kind: "boolean", unknown: null };
  }

  if (t === "DATE" || t === "DATETIME" || t === "TIMESTAMP") {
    return { kind: "date", unknown: null };
  }

  if (t === "JSON") {
    return { kind: "json", unknown: null };
  }

  return { kind: "string", unknown: dbType };
}

export function mapSqliteColumns(
  colRows: [number, string, string, number, string | null, number][],
  fkRows: [number, number, string, string, string, string, string, string][],
) {
  const fkMap = new Map<string, [string, string, string]>();

  for (const [, , refTable, fromCol, toCol, , onDelete] of fkRows) {
    fkMap.set(fromCol, [refTable, toCol, onDelete]);
  }

  return colRows.map(
    ([, name, type, notnull, dfltValue, pk]): IntrospectedColumn => {
      const { kind, unknown } = mapDbType(type);
      const fk = fkMap.get(name);

      return {
        sqlName: name,
        kind,
        nullable: notnull === 0 && pk === 0,
        primaryKey: pk > 0,
        unique: false,
        rawDefault: dfltValue,
        arrayElementKind: null,
        references: fk
          ? {
              table: fk[0],
              column: fk[1],
              onDelete: toOnDelete(fk[2]),
            }
          : null,
        unknownDbType: unknown,
      };
    },
  );
}

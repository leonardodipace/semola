import type { ColumnKind } from "../../types.js";
import { toOnDelete } from "../shared.js";
import type { IntrospectedColumn } from "../types.js";

function mapDbType(dbType: string): {
  kind: ColumnKind;
  unknown: string | null;
} {
  const t = dbType
    .toLowerCase()
    .replace(/\(.*\)/, "")
    .trim();

  if (
    t === "varchar" ||
    t === "char" ||
    t === "text" ||
    t === "tinytext" ||
    t === "mediumtext" ||
    t === "longtext" ||
    t === "enum" ||
    t === "set"
  ) {
    return { kind: "string", unknown: null };
  }

  if (
    t === "int" ||
    t === "tinyint" ||
    t === "smallint" ||
    t === "mediumint" ||
    t === "bigint" ||
    t === "integer" ||
    t === "decimal" ||
    t === "numeric" ||
    t === "float" ||
    t === "double" ||
    t === "real"
  ) {
    return { kind: "number", unknown: null };
  }

  if (t === "boolean" || t === "bool" || t === "bit") {
    return { kind: "boolean", unknown: null };
  }

  if (
    t === "date" ||
    t === "datetime" ||
    t === "timestamp" ||
    t === "time" ||
    t === "year"
  ) {
    return { kind: "date", unknown: null };
  }

  if (t === "json") {
    return { kind: "json", unknown: null };
  }

  return { kind: "string", unknown: dbType };
}

export function mapMysqlColumns(
  colRows: [string, string, string, string | null, string, string][],
  fkRows: [string, string, string, string][],
) {
  const fkMap = new Map<string, [string, string, string]>();

  for (const [
    columnName,
    referencedTable,
    referencedColumn,
    deleteRule,
  ] of fkRows) {
    fkMap.set(columnName, [referencedTable, referencedColumn, deleteRule]);
  }

  return colRows.map(
    ([
      columnName,
      dataType,
      isNullable,
      columnDefault,
      columnKey,
    ]): IntrospectedColumn => {
      const { kind, unknown } = mapDbType(dataType);
      const fk = fkMap.get(columnName);

      return {
        sqlName: columnName,
        kind,
        nullable: isNullable === "YES",
        primaryKey: columnKey === "PRI",
        unique: columnKey === "UNI",
        rawDefault: columnDefault,
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

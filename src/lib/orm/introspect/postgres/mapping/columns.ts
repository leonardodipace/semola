import { toOnDelete } from "../../shared.js";
import type { IntrospectedColumn } from "../../types.js";
import { mapDbType } from "./type-map.js";

type ColumnRow = [string, string, string, string, string | null];
type ConstraintRow = [string, string, number?];
type ForeignKeyRow = [string, string, string, string];

function buildPrimaryKeys(constraintRows: ConstraintRow[]) {
  return new Set(
    constraintRows
      .filter(([, constraintType]) => constraintType === "PRIMARY KEY")
      .map(([columnName]) => columnName),
  );
}

function buildUniqueColumns(constraintRows: ConstraintRow[]) {
  return new Set(
    constraintRows
      .filter(([, constraintType, constrainedColumns]) => {
        if (constraintType !== "UNIQUE") {
          return false;
        }

        if (constrainedColumns === undefined) {
          return true;
        }

        return constrainedColumns === 1;
      })
      .map(([columnName]) => columnName),
  );
}

function buildForeignKeyMap(fkRows: ForeignKeyRow[]) {
  const fkMap = new Map<string, [string, string, string]>();

  for (const [
    columnName,
    foreignTableName,
    foreignColumnName,
    deleteRule,
  ] of fkRows) {
    fkMap.set(columnName, [foreignTableName, foreignColumnName, deleteRule]);
  }

  return fkMap;
}

export function mapColumns(
  colRows: ColumnRow[],
  constraintRows: ConstraintRow[],
  fkRows: ForeignKeyRow[],
  enumMap: Map<string, string[]>,
) {
  const enumTypes = new Set(enumMap.keys());
  const primaryKeys = buildPrimaryKeys(constraintRows);
  const uniqueCols = buildUniqueColumns(constraintRows);
  const fkMap = buildForeignKeyMap(fkRows);

  return colRows.map(
    ([
      columnName,
      udtName,
      dataType,
      isNullable,
      columnDefault,
    ]): IntrospectedColumn => {
      const { kind, unknown, arrayElementKind, enumValues } = mapDbType(
        dataType,
        udtName,
        enumTypes,
      );

      let resolvedEnumValues = enumValues;

      if (resolvedEnumValues !== null) {
        const enumTypeName =
          dataType.toLowerCase() === "array"
            ? udtName.toLowerCase().replace(/^_/, "")
            : udtName.toLowerCase();

        resolvedEnumValues = enumMap.get(enumTypeName) ?? [];
      }

      const fk = fkMap.get(columnName);

      return {
        sqlName: columnName,
        kind,
        enumValues: resolvedEnumValues,
        nullable: isNullable === "YES",
        primaryKey: primaryKeys.has(columnName),
        unique: uniqueCols.has(columnName),
        rawDefault: columnDefault,
        arrayElementKind,
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

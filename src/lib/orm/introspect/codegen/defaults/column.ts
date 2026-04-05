import type { IntrospectedColumn } from "../../types.js";
import { buildEnumValues } from "../naming.js";
import { mapRawDefaultToChain } from "./parsing.js";

function buildColumnFactory(col: IntrospectedColumn) {
  if (col.enumValues && col.enumValues.length > 0) {
    const enumValues = buildEnumValues(col.enumValues);
    return `enumeration("${col.sqlName}", ${enumValues})`;
  }

  return `${col.kind}("${col.sqlName}")`;
}

export function buildColumnCall(col: IntrospectedColumn) {
  const parts: string[] = [buildColumnFactory(col)];

  if (col.arrayElementKind) {
    parts.push("asArray()");
  }

  if (col.primaryKey) {
    parts.push("primaryKey()");
  }

  const defaultChain = mapRawDefaultToChain(col);

  if (defaultChain) {
    parts.push(defaultChain);
  }

  if (!col.nullable && !col.primaryKey) {
    parts.push("notNull()");
  }

  if (col.unique && !col.primaryKey) {
    parts.push("unique()");
  }

  if (col.references) {
    const onDelete = col.references.onDelete;

    if (onDelete) {
      parts.push(`onDelete("${onDelete}")`);
    }
  }

  return parts.join(".");
}

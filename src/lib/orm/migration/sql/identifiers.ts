import type { SchemaSnapshot } from "../types.js";

export function quoteIdentifier(
  dialect: SchemaSnapshot["dialect"],
  identifier: string,
) {
  if (dialect === "mysql") {
    return `\`${identifier.replaceAll("`", "``")}\``;
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

export function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

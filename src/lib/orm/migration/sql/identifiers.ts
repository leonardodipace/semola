import {
  quoteWithBackticks,
  quoteWithDoubleQuotes,
} from "../../dialect/utils.js";
import type { SchemaSnapshot } from "../types.js";

export function quoteIdentifier(
  dialect: SchemaSnapshot["dialect"],
  identifier: string,
) {
  if (dialect === "mysql") {
    return quoteWithBackticks(identifier);
  }

  return quoteWithDoubleQuotes(identifier);
}

export function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

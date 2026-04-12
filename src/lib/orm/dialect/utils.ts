import type { ColumnKind, Dialect } from "../types.js";

export function escapeLike(s: string) {
  return s.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function renderLikePattern(
  mode: "startsWith" | "endsWith" | "contains",
  value: string,
) {
  const escaped = escapeLike(value);

  if (mode === "startsWith") {
    return `${escaped}%`;
  }

  if (mode === "endsWith") {
    return `%${escaped}`;
  }

  return `%${escaped}%`;
}

export function serializeSqlValue(kind: ColumnKind, value: unknown) {
  if (kind === "date") {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  }

  if (kind === "json" || kind === "jsonb") {
    return JSON.stringify(value);
  }

  if (kind === "boolean") {
    if (value === true) return 1;
    if (value === false) return 0;
  }

  return value;
}

export function quoteWithDoubleQuotes(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function quoteWithBackticks(identifier: string) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

export function inferDialectFromUrl(url: string): Dialect {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return "postgres";
  }

  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) {
    return "mysql";
  }

  return "sqlite";
}

export function isDialect(value: Dialect) {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

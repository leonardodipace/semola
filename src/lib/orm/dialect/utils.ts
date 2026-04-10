import type { Dialect } from "../types.js";

export function inferDialectFromUrl(url: string): Dialect {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return "postgres"
  }

  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) {
    return "mysql";
  }

  return "sqlite";
}

export function isDialect(value: Dialect) {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

import type { Dialect } from "../types.js";

export function inferDialectFromUrl(url: string): Dialect {
  if (url.includes("mysql")) {
    return "mysql";
  }

  if (url.includes("postgresql")) {
    return "postgres";
  }

  if (url.includes("postgres")) {
    return "postgres";
  }

  return "sqlite";
}

export function isDialect(value: string): value is Dialect {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

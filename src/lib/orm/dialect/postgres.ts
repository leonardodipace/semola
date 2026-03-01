import type { DialectAdapter } from "../types.js";

function escapeLike(s: string) {
  return s.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export const postgresDialectAdapter: DialectAdapter = {
  dialect: "postgres",

  quoteIdentifier(identifier: string) {
    return `"${identifier.replaceAll('"', '""')}"`;
  },

  serializeValue(_kind, value) {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  },

  renderLikePattern(mode, value) {
    const escaped = escapeLike(value);

    if (mode === "startsWith") {
      return `${escaped}%`;
    }

    if (mode === "endsWith") {
      return `%${escaped}`;
    }

    return `%${escaped}%`;
  },
};

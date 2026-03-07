import type { DialectAdapter } from "../types.js";

function escapeLike(s: string) {
  return s.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export const mysqlDialectAdapter: DialectAdapter = {
  dialect: "mysql",

  quoteIdentifier(identifier: string) {
    return `\`${identifier.replaceAll("`", "``")}\``;
  },

  serializeValue(kind, value) {
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

import type { DialectAdapter } from "../types.js";
import { renderLikePattern } from "./utils.js";

export const postgresDialectAdapter: DialectAdapter = {
  dialect: "postgres",
  likeKeyword: "ILIKE",

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
    return renderLikePattern(mode, value);
  },
};

import type { DialectAdapter } from "../types.js";
import { quoteWithDoubleQuotes, renderLikePattern } from "./utils.js";

export const postgresDialectAdapter: DialectAdapter = {
  dialect: "postgres",
  likeKeyword: "ILIKE",

  quoteIdentifier(identifier: string) {
    return quoteWithDoubleQuotes(identifier);
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

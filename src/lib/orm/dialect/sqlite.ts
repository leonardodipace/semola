import type { DialectAdapter } from "../types.js";
import { quoteWithDoubleQuotes, renderLikePattern, serializeSqlValue } from "./utils.js";

export const sqliteDialectAdapter: DialectAdapter = {
  dialect: "sqlite",
  likeKeyword: "LIKE",

  quoteIdentifier(identifier: string) {
    return quoteWithDoubleQuotes(identifier);
  },

  serializeValue(kind, value) {
    return serializeSqlValue(kind, value);
  },

  renderLikePattern(mode, value) {
    return renderLikePattern(mode, value);
  },
};

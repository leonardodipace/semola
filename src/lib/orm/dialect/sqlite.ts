import type { DialectAdapter } from "../types.js";
import { renderLikePattern, serializeSqlValue } from "./utils.js";

export const sqliteDialectAdapter: DialectAdapter = {
  dialect: "sqlite",
  likeKeyword: "LIKE",

  quoteIdentifier(identifier: string) {
    return `"${identifier.replaceAll('"', '""')}"`;
  },

  serializeValue(kind, value) {
    return serializeSqlValue(kind, value);
  },

  renderLikePattern(mode, value) {
    return renderLikePattern(mode, value);
  },
};

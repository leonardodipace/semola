import type { DialectAdapter } from "../types.js";
import {
  quoteWithBackticks,
  renderLikePattern,
  serializeSqlValue,
} from "./utils.js";

export const mysqlDialectAdapter: DialectAdapter = {
  dialect: "mysql",
  likeKeyword: "LIKE",

  quoteIdentifier(identifier: string) {
    return quoteWithBackticks(identifier);
  },

  serializeValue(kind, value) {
    return serializeSqlValue(kind, value);
  },

  renderLikePattern(mode, value) {
    return renderLikePattern(mode, value);
  },
};

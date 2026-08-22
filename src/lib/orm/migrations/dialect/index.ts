import type { Adapter } from "../../dialect/types.js";
import { MigrationError } from "../../errors.js";
import { PostgresMigrationDialect } from "./postgres.js";
import { SqliteMigrationDialect } from "./sqlite.js";

export type { MigrationDialect } from "./dialect.js";
export { SCHEMA_HEADER_PREFIX } from "./dialect.js";

export const getMigrationDialect = (adapter: Adapter) => {
  switch (adapter) {
    case "sqlite":
      return new SqliteMigrationDialect();
    case "postgres":
      return new PostgresMigrationDialect();
    default:
      throw new MigrationError(`Unsupported adapter: ${adapter}`);
  }
};

import type { Adapter } from "../../dialect/types.js";
import { MigrationError } from "../../errors.js";
import type { MigrationDialect } from "./dialect.js";
import { PostgresMigrationDialect } from "./postgres.js";
import { SqliteMigrationDialect } from "./sqlite.js";

export { SCHEMA_HEADER_PREFIX } from "./dialect.js";
export type { MigrationDialect };

export const getMigrationDialect = (adapter: Adapter): MigrationDialect => {
  switch (adapter) {
    case "sqlite":
      return new SqliteMigrationDialect();
    case "postgres":
      return new PostgresMigrationDialect();
    default:
      throw new MigrationError(`Unsupported adapter: ${adapter}`);
  }
};

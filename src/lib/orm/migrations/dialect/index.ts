import type { Adapter } from "../../dialect/types.js";
import { MigrationError } from "../../errors.js";
import { MigrationDialect } from "./dialect.js";
import { POSTGRES_MIGRATION_SPEC } from "./postgres.js";
import { SQLITE_MIGRATION_SPEC } from "./sqlite.js";

export type { MigrationDialect } from "./dialect.js";

export const getMigrationDialect = (adapter: Adapter) => {
  switch (adapter) {
    case "sqlite":
      return new MigrationDialect(SQLITE_MIGRATION_SPEC);
    case "postgres":
      return new MigrationDialect(POSTGRES_MIGRATION_SPEC);
    default:
      throw new MigrationError(`Unsupported adapter: ${adapter}`);
  }
};

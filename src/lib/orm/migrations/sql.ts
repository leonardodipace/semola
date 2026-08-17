import { mightThrowSync } from "../../errors/index.js";
import type { Adapter } from "../dialect/types.js";
import { MigrationError } from "../errors.js";
import type { MigrationDialect } from "./dialect.js";
import { PostgresMigrationDialect } from "./postgres.js";
import { SqliteMigrationDialect } from "./sqlite.js";
import type { MigrationOp, SchemaSnapshot } from "./types.js";

const SCHEMA_HEADER_PREFIX = "-- semola-schema:";

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

export const decodeSchemaHeader = (sql: string) => {
  const firstLine = (sql.split("\n")[0] ?? "").trimEnd();

  if (!firstLine.startsWith(SCHEMA_HEADER_PREFIX)) {
    return undefined;
  }

  const [error, schema] = mightThrowSync(() => {
    return JSON.parse(
      firstLine.slice(SCHEMA_HEADER_PREFIX.length),
    ) as SchemaSnapshot;
  });

  if (error) {
    throw new MigrationError(`Invalid schema header: ${error.message}`);
  }

  return schema;
};

export const renderMigrationSql = (
  adapter: Adapter,
  ops: MigrationOp[],
  schemaHeader?: SchemaSnapshot,
) => {
  return getMigrationDialect(adapter).render(ops, schemaHeader);
};

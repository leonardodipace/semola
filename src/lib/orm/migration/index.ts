export { defineMigration } from "./define.js";
export type {
  Migration,
  MigrationDefinition,
  SemolaMigrationConfig,
} from "./types.js";
// Migration execution functions (apply, create, status, rollback)
// and SchemaBuilder are CLI-only and should not be exposed in the public API

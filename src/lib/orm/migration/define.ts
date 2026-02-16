import type { MigrationDefinition } from "./types.js";

export const defineMigration = <const T extends MigrationDefinition>(
  migration: T,
) => {
  return migration;
};

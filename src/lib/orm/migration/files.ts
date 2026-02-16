import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { err, mightThrow, ok } from "../../errors/index.js";
import type { MigrationDefinition, MigrationFile } from "./types.js";

const migrationRegex = /^(\d{14})_([a-zA-Z0-9_-]+)\.(ts|js|mts|mjs|cts|cjs)$/;

const isMigrationDefinition = (value: unknown) => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const up = Reflect.get(value, "up");
  const down = Reflect.get(value, "down");

  return typeof up === "function" && typeof down === "function";
};

export const scanMigrationFiles = async (dirPath: string) => {
  const files: MigrationFile[] = [];

  const [error, entries] = await mightThrow(
    readdir(dirPath, { withFileTypes: true }),
  );
  if (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!entries) {
    return ok([]);
  }

  for (const entry of entries) {
    if (!("isFile" in entry) || typeof entry.isFile !== "function") {
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const match = migrationRegex.exec(entry.name);
    if (!match) {
      continue;
    }

    const version = match[1];
    const name = match[2];

    if (!version || !name) {
      continue;
    }

    files.push({
      version,
      name,
      filePath: `${dirPath}/${entry.name}`,
    });
  }

  files.sort((left, right) => {
    if (left.version < right.version) return -1;
    if (left.version > right.version) return 1;
    return 0;
  });

  return ok(files);
};

export const loadMigration = async (file: MigrationFile) => {
  // Convert file path to file:// URL for dynamic import
  const moduleUrl = pathToFileURL(file.filePath).href;
  const mod = await import(`${moduleUrl}?cache=${Date.now()}`);
  const definition = Reflect.get(mod, "default") as MigrationDefinition;

  if (!isMigrationDefinition(definition)) {
    return err(
      "ValidationError",
      `Invalid migration file ${file.filePath}: default export must be defineMigration({ up, down })`,
    );
  }

  return ok({
    version: file.version,
    name: file.name,
    filePath: file.filePath,
    up: definition.up,
    down: definition.down,
  });
};

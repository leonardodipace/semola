import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MigrationInfo } from "../types.js";
import { migrationDirectoryPath } from "./naming.js";

export async function ensureMigrationsDirectory(migrationsDir: string) {
  await mkdir(migrationsDir, { recursive: true });
}

export async function listMigrations(migrationsDir: string) {
  let entries: Array<{ isDirectory: () => boolean; name: string }> = [];

  try {
    const dirEntries = await readdir(migrationsDir, {
      withFileTypes: true,
      encoding: "utf8",
    });

    entries = dirEntries;
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
      return [];
    }

    throw error;
  }

  const migrationDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const migrations: MigrationInfo[] = [];

  for (const directoryName of migrationDirs) {
    const splitIndex = directoryName.indexOf("_");

    if (splitIndex < 0) {
      continue;
    }

    const id = directoryName.slice(0, splitIndex);
    const name = directoryName.slice(splitIndex + 1);
    const directoryPath = join(migrationsDir, directoryName);

    migrations.push({
      id,
      name,
      directoryName,
      directoryPath,
      upPath: join(directoryPath, "up.sql"),
      downPath: join(directoryPath, "down.sql"),
      snapshotPath: join(directoryPath, "snapshot.json"),
    });
  }

  return migrations;
}

export async function uniqueMigrationDirectoryPath(
  migrationsDir: string,
  id: string,
  name: string,
) {
  let candidateId = id;
  let attempt = 0;

  while (true) {
    const dirPath = migrationDirectoryPath(migrationsDir, candidateId, name);

    let stats: { isDirectory: () => boolean } | null = null;

    try {
      stats = await stat(dirPath);
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
        stats = null;
      } else {
        throw error;
      }
    }

    let exists = false;

    if (stats) {
      exists = stats.isDirectory();
    }

    if (!exists) {
      return {
        migrationId: candidateId,
        migrationDir: dirPath,
      };
    }

    attempt += 1;
    candidateId = `${id}${String(attempt).padStart(2, "0")}`;
  }
}

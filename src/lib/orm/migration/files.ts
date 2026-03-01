import type { Dirent } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MigrationInfo } from "./types.js";

export async function ensureMigrationsDirectory(migrationsDir: string) {
  await mkdir(migrationsDir, { recursive: true });
}

export async function listMigrations(migrationsDir: string) {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(migrationsDir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch {
    return [] as MigrationInfo[];
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

export function nowMigrationId() {
  const now = new Date();
  const parts = [
    now.getUTCFullYear().toString(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
    String(now.getUTCMilliseconds()).padStart(3, "0"),
  ];
  return parts.join("");
}

export function toMigrationName(value: string) {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) {
    return "migration";
  }
  return name;
}

export function migrationDirectoryPath(
  migrationsDir: string,
  id: string,
  name: string,
) {
  return join(migrationsDir, `${id}_${name}`);
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
    let exists = false;
    try {
      const stats = await stat(dirPath);
      exists = stats.isDirectory();
    } catch {
      exists = false;
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

export function relativeFromCwd(cwd: string, absolutePath: string) {
  if (!absolutePath.startsWith(cwd)) {
    return absolutePath;
  }

  const rel = absolutePath.slice(cwd.length + 1);
  if (!rel) {
    return basename(absolutePath);
  }
  return rel;
}

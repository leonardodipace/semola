import { join } from "node:path";

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

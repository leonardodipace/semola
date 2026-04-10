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
  let name = "";
  let wasSeparator = false;

  for (const char of value.trim().toLowerCase()) {
    const code = char.charCodeAt(0);
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;

    if (isLower || isDigit) {
      name += char;
      wasSeparator = false;
      continue;
    }

    if (name.length === 0) {
      continue;
    }

    if (wasSeparator) {
      continue;
    }

    name += "_";
    wasSeparator = true;
  }

  if (name.endsWith("_")) {
    name = name.slice(0, -1);
  }

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

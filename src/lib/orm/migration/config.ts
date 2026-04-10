import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedSemolaConfig, SemolaConfig } from "./types.js";

export function defineConfig(config: SemolaConfig) {
  return config;
}

const defaultMigrationDir = "migrations";
const defaultIntrospectOutput = "orm.generated.ts";

async function findConfigPath(cwd: string) {
  const candidates = [
    "semola.config.ts",
    "semola.config.js",
    "semola.config.mjs",
  ];
  for (const candidate of candidates) {
    const configPath = resolve(cwd, candidate);
    const exists = await Bun.file(configPath).exists();
    if (exists) {
      return configPath;
    }
  }
  return null;
}

export async function loadConfig(cwd = process.cwd()) {
  const configPath = await findConfigPath(cwd);

  if (!configPath) {
    throw new Error("Could not find semola.config.ts in current directory");
  }

  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(`${configUrl}?t=${Date.now()}`);

  const loadedConfig = Reflect.get(mod, "default");

  if (typeof loadedConfig !== "object") {
    throw new Error("semola.config.ts must export a default config object");
  }

  if (loadedConfig === null) {
    throw new Error("semola.config.ts must export a default config object");
  }

  const orm = Reflect.get(loadedConfig, "orm");

  if (typeof orm !== "object") {
    throw new Error("semola.config.ts must contain an orm section");
  }

  if (orm === null) {
    throw new Error("semola.config.ts must contain an orm section");
  }

  const schema = Reflect.get(orm, "schema");

  if (typeof schema !== "string") {
    throw new Error("semola.config.ts must define orm.schema");
  }

  const migrations = Reflect.get(orm, "migrations");
  const introspect = Reflect.get(orm, "introspect");

  const migrationDirValue =
    typeof migrations === "object" && migrations !== null
      ? Reflect.get(migrations, "dir")
      : null;

  const migrationDir =
    typeof migrationDirValue === "string"
      ? migrationDirValue
      : defaultMigrationDir;

  const transactionalValue =
    typeof migrations === "object" && migrations !== null
      ? Reflect.get(migrations, "transactional")
      : null;

  const transactional =
    typeof transactionalValue === "boolean" ? transactionalValue : true;

  const introspectOutputValue =
    typeof introspect === "object" && introspect !== null
      ? Reflect.get(introspect, "output")
      : null;

  const introspectOutput =
    typeof introspectOutputValue === "string"
      ? introspectOutputValue
      : defaultIntrospectOutput;

  const introspectUrlValue =
    typeof introspect === "object" && introspect !== null
      ? Reflect.get(introspect, "url")
      : null;

  const introspectUrl =
    typeof introspectUrlValue === "string" ? introspectUrlValue : null;

  const introspectDialectValue =
    typeof introspect === "object" && introspect !== null
      ? Reflect.get(introspect, "dialect")
      : null;

  const introspectDialect =
    introspectDialectValue === "postgres" ||
    introspectDialectValue === "mysql" ||
    introspectDialectValue === "sqlite"
      ? introspectDialectValue
      : null;

  const resolved: ResolvedSemolaConfig = {
    cwd,
    configPath,
    orm: {
      schema: resolve(cwd, schema),
      migrations: {
        dir: resolve(cwd, migrationDir),
        transactional,
      },
      introspect: {
        output: resolve(cwd, introspectOutput),
        url: introspectUrl,
        dialect: introspectDialect,
      },
    },
  };

  return resolved;
}

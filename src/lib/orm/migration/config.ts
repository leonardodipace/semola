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

  const loadedConfig = (mod as Record<string, unknown>).default as
    | SemolaConfig
    | undefined;

  if (!loadedConfig) {
    throw new Error("semola.config.ts must export a default config object");
  }

  if (!loadedConfig.orm) {
    throw new Error("semola.config.ts must contain an orm section");
  }

  if (!loadedConfig.orm.schema) {
    throw new Error("semola.config.ts must define orm.schema");
  }

  const migrationDir = loadedConfig.orm.migrations?.dir ?? defaultMigrationDir;
  const transactional = loadedConfig.orm.migrations?.transactional ?? true;
  const introspectOutput =
    loadedConfig.orm.introspect?.output ?? defaultIntrospectOutput;
  const introspectUrl = loadedConfig.orm.introspect?.url ?? null;
  const introspectDialect = loadedConfig.orm.introspect?.dialect ?? null;

  const resolved: ResolvedSemolaConfig = {
    cwd,
    configPath,
    orm: {
      schema: resolve(cwd, loadedConfig.orm.schema),
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

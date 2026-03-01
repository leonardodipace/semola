import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { err, mightThrow, ok } from "../../errors/index.js";
import type { ResolvedSemolaConfig, SemolaConfig } from "./types.js";

export function defineConfig(config: SemolaConfig) {
  return config;
}

const defaultMigrationDir = "migrations";
const defaultStateFile = ".semola-migrations.json";

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
    return err(
      "ConfigError",
      "Could not find semola.config.ts in current directory",
    );
  }

  const configUrl = pathToFileURL(configPath).href;
  const [importErr, mod] = await mightThrow(
    import(`${configUrl}?t=${Date.now()}`),
  );
  if (importErr) {
    return err(
      "ConfigError",
      `Could not load semola.config.ts: ${importErr instanceof Error ? importErr.message : String(importErr)}`,
    );
  }

  const loadedConfig = (mod as Record<string, unknown>).default as
    | SemolaConfig
    | undefined;

  if (!loadedConfig) {
    return err(
      "ConfigError",
      "semola.config.ts must export a default config object",
    );
  }

  if (!loadedConfig.orm) {
    return err("ConfigError", "semola.config.ts must contain an orm section");
  }

  if (!loadedConfig.orm.schema) {
    return err("ConfigError", "semola.config.ts must define orm.schema");
  }

  const migrationDir = loadedConfig.orm.migrations?.dir ?? defaultMigrationDir;
  const stateFile = loadedConfig.orm.migrations?.stateFile ?? defaultStateFile;
  const transactional = loadedConfig.orm.migrations?.transactional ?? true;

  const resolved: ResolvedSemolaConfig = {
    cwd,
    configPath,
    orm: {
      schema: resolve(cwd, loadedConfig.orm.schema),
      migrations: {
        dir: resolve(cwd, migrationDir),
        stateFile: resolve(cwd, stateFile),
        transactional,
      },
    },
  };

  return ok(resolved);
}

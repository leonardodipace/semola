import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SemolaMigrationConfig } from "../lib/orm/migration/types.js";
import type { Table } from "../lib/orm/table/index.js";

const toError = (value: unknown) => {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isTableLike = (value: unknown): value is Table => {
  if (!isObject(value)) {
    return false;
  }

  const sqlName = Reflect.get(value, "sqlName");
  const columns = Reflect.get(value, "columns");

  return typeof sqlName === "string" && isObject(columns);
};

const validateConfig = (value: unknown): SemolaMigrationConfig => {
  if (!isObject(value)) {
    throw new Error("Invalid semola config: expected object");
  }

  const orm = Reflect.get(value, "orm");
  const schema = Reflect.get(value, "schema");

  if (!isObject(orm)) {
    throw new Error("Invalid semola config: missing orm section");
  }

  if (!isObject(schema)) {
    throw new Error("Invalid semola config: missing schema section");
  }

  const dialect = Reflect.get(orm, "dialect");
  const url = Reflect.get(orm, "url");
  const path = Reflect.get(schema, "path");
  const exportName = Reflect.get(schema, "exportName");

  if (dialect !== "sqlite" && dialect !== "mysql" && dialect !== "postgres") {
    throw new Error("Invalid semola config: orm.dialect is required");
  }

  if (typeof url !== "string" || url.length === 0) {
    throw new Error("Invalid semola config: orm.url is required");
  }

  if (typeof path !== "string" || path.length === 0) {
    throw new Error("Invalid semola config: schema.path is required");
  }

  if (exportName !== undefined && typeof exportName !== "string") {
    throw new Error("Invalid semola config: schema.exportName must be string");
  }

  return {
    orm: {
      dialect,
      url,
    },
    schema: {
      path,
      exportName,
    },
  };
};

const tryResolveConfigFile = async (cwd: string) => {
  const candidates = [
    "semola.config.ts",
    "semola.config.js",
    "semola.config.mjs",
  ];

  for (const candidate of candidates) {
    const fullPath = resolve(cwd, candidate);
    try {
      const fileStat = await stat(fullPath);
      if (fileStat.isFile()) {
        return fullPath;
      }
    } catch {}
  }

  return null;
};

export const loadSemolaConfig = async (cwd: string) => {
  try {
    const filePath = await tryResolveConfigFile(cwd);

    if (!filePath) {
      return [new Error("Missing semola config file"), null] as const;
    }

    const moduleUrl = pathToFileURL(filePath).href;
    const mod = await import(`${moduleUrl}?cache=${Date.now()}`);
    const raw = Reflect.get(mod, "default") ?? mod;
    const config = validateConfig(raw);

    return [
      null,
      {
        ...config,
        schema: {
          ...config.schema,
          path: resolve(cwd, config.schema.path),
        },
      },
    ] as const;
  } catch (error) {
    return [toError(error), null] as const;
  }
};

const toTableRecord = (value: unknown) => {
  if (Array.isArray(value)) {
    const record: Record<string, Table> = {};
    for (const entry of value) {
      if (!isTableLike(entry)) {
        throw new Error("Schema export array must contain Table instances");
      }
      record[entry.sqlName] = entry;
    }
    return record;
  }

  if (!isObject(value)) {
    throw new Error("Schema export must be an object or an array of tables");
  }

  const record: Record<string, Table> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isTableLike(entry)) {
      throw new Error(`Schema export field ${key} is not a Table instance`);
    }
    record[key] = entry;
  }
  return record;
};

export const loadSchemaTables = async (
  schemaPath: string,
  exportName?: string,
) => {
  try {
    const moduleUrl = pathToFileURL(schemaPath).href;
    const mod = await import(`${moduleUrl}?cache=${Date.now()}`);
    const key = exportName ?? "tables";
    const exportedValue = Reflect.get(mod, key) ?? Reflect.get(mod, "default");

    if (exportedValue === undefined) {
      return [
        new Error(
          `Schema module does not export ${key} or a default export with tables`,
        ),
        null,
      ] as const;
    }

    const tables = toTableRecord(exportedValue);
    return [null, tables] as const;
  } catch (error) {
    return [toError(error), null] as const;
  }
};

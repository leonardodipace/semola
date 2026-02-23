import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { err, mightThrow, ok } from "../lib/errors/index.js";
import type { Table } from "../lib/orm/table/index.js";

const isObject = (value: unknown) => {
  return typeof value === "object" && value !== null;
};

const isDialect = (value: unknown) => {
  return value === "sqlite" || value === "mysql" || value === "postgres";
};

const isTableLike = (value: unknown) => {
  if (!isObject(value)) {
    return false;
  }

  const sqlName = Reflect.get(value, "sqlName");
  const columns = Reflect.get(value, "columns");

  return typeof sqlName === "string" && isObject(columns);
};

const validateConfig = (value: unknown) => {
  if (!isObject(value)) {
    return err("ValidationError", "Invalid semola config: expected object");
  }

  const orm = Reflect.get(value, "orm");

  if (!isObject(orm)) {
    return err("ValidationError", "Invalid semola config: missing orm section");
  }

  const dialect = Reflect.get(orm, "dialect");
  const url = Reflect.get(orm, "url");
  const schema = Reflect.get(orm, "schema");

  if (dialect === undefined) {
    return err(
      "ValidationError",
      "Invalid semola config: orm.dialect is required",
    );
  }

  if (!isDialect(dialect)) {
    return err(
      "ValidationError",
      `Invalid semola config: unsupported orm.dialect value "${String(dialect)}"`,
    );
  }

  if (typeof url !== "string" || url.length === 0) {
    return err("ValidationError", "Invalid semola config: orm.url is required");
  }

  if (!isObject(schema)) {
    return err(
      "ValidationError",
      "Invalid semola config: missing orm.schema section",
    );
  }

  const path = Reflect.get(schema, "path");
  const exportName = Reflect.get(schema, "exportName");

  if (typeof path !== "string" || path.length === 0) {
    return err(
      "ValidationError",
      "Invalid semola config: orm.schema.path is required",
    );
  }

  if (exportName !== undefined && typeof exportName !== "string") {
    return err(
      "ValidationError",
      "Invalid semola config: orm.schema.exportName must be string",
    );
  }

  return ok({
    orm: {
      dialect: dialect as "sqlite" | "mysql" | "postgres",
      url,
      schema: {
        path,
        exportName,
      },
    },
  });
};

const tryResolveConfigFile = async (cwd: string) => {
  const candidates = [
    "semola.config.ts",
    "semola.config.js",
    "semola.config.mjs",
  ];

  for (const candidate of candidates) {
    const fullPath = resolve(cwd, candidate);
    const [statError, statResult] = await mightThrow(stat(fullPath));
    if (statError || !statResult) {
      continue;
    }

    if (statResult.isFile()) {
      return fullPath;
    }
  }

  return null;
};

const importModule = async (filePath: string) => {
  const moduleUrl = pathToFileURL(filePath).href;
  return await mightThrow(import(`${moduleUrl}?cache=${Date.now()}`));
};

export const loadSemolaConfig = async (cwd: string) => {
  const filePath = await tryResolveConfigFile(cwd);

  if (!filePath) {
    return err("NotFoundError", "Missing semola config file");
  }

  const [importError, mod] = await importModule(filePath);
  if (importError || !mod) {
    return err(
      "InternalServerError",
      importError instanceof Error ? importError.message : String(importError),
    );
  }

  const raw = Reflect.get(mod, "default") ?? mod;
  const [configError, config] = validateConfig(raw);

  if (configError) {
    return err("ValidationError", configError.message);
  }

  return ok({
    orm: {
      ...config.orm,
      schema: {
        ...config.orm.schema,
        path: resolve(cwd, config.orm.schema.path),
      },
    },
  });
};

export const loadSchemaTables = async (schemaPath: string) => {
  const [importError, mod] = await importModule(schemaPath);
  if (importError || !mod) {
    return err(
      "InternalServerError",
      importError instanceof Error ? importError.message : String(importError),
    );
  }

  const exportedValue = Reflect.get(mod, "default");

  if (!isObject(exportedValue)) {
    return err(
      "ValidationError",
      "Schema module must have a default export of an Orm instance",
    );
  }

  const rawTables = Reflect.get(exportedValue, "rawTables");

  if (!isObject(rawTables)) {
    return err(
      "ValidationError",
      "Schema module must have a default export of an Orm instance",
    );
  }

  const record: Record<string, Table> = {};
  for (const [key, entry] of Object.entries(rawTables)) {
    if (!isTableLike(entry)) {
      return err(
        "ValidationError",
        `Schema export field ${key} is not a Table instance`,
      );
    }
    record[key] = entry as Table;
  }

  return ok(record);
};

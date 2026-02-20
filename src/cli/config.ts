import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { err, ok } from "../lib/errors/index.js";
import type { Table } from "../lib/orm/table/index.js";

const isObject = (value: unknown) => {
  return typeof value === "object" && value !== null;
};

const isDialect = (
  value: unknown,
): value is "sqlite" | "mysql" | "postgres" => {
  return value === "sqlite" || value === "mysql" || value === "postgres";
};

const isTableLike = (value: unknown): value is Table => {
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

  if (!isDialect(dialect)) {
    return err(
      "ValidationError",
      "Invalid semola config: orm.dialect is required",
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
      dialect,
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
    try {
      const statResult = await stat(fullPath);
      if (statResult.isFile()) {
        return fullPath;
      }
    } catch {
      // File doesn't exist, continue to next candidate
    }
  }

  return null;
};

export const loadSemolaConfig = async (cwd: string) => {
  const filePath = await tryResolveConfigFile(cwd);

  if (!filePath) {
    return err("NotFoundError", "Missing semola config file");
  }

  try {
    // Convert file path to file:// URL for dynamic import
    const moduleUrl = pathToFileURL(filePath).href;
    const mod = await import(`${moduleUrl}?cache=${Date.now()}`);
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
  } catch (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }
};

const toTableRecord = (value: unknown) => {
  if (Array.isArray(value)) {
    const record: Record<string, Table> = {};
    for (const entry of value) {
      if (!isTableLike(entry)) {
        return err(
          "ValidationError",
          "Schema export array must contain Table instances",
        );
      }

      if (entry.sqlName in record) {
        return err(
          "ValidationError",
          `Schema export array contains duplicate table sqlName: ${entry.sqlName}`,
        );
      }

      record[entry.sqlName] = entry;
    }
    return ok(record);
  }

  if (!isObject(value)) {
    return err(
      "ValidationError",
      "Schema export must be an object or an array of tables",
    );
  }

  const record: Record<string, Table> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isTableLike(entry)) {
      return err(
        "ValidationError",
        `Schema export field ${key} is not a Table instance`,
      );
    }
    record[key] = entry;
  }
  return ok(record);
};

export const loadSchemaTables = async (
  schemaPath: string,
  exportName?: string,
) => {
  try {
    // Convert file path to file:// URL for dynamic import
    const moduleUrl = pathToFileURL(schemaPath).href;
    const mod = await import(`${moduleUrl}?cache=${Date.now()}`);
    const key = exportName ?? "tables";

    // Check if the named export exists; if not, fall back to default
    const exportedValue =
      key in mod ? Reflect.get(mod, key) : Reflect.get(mod, "default");

    if (exportedValue === undefined) {
      return err(
        "NotFoundError",
        `Schema module does not export ${key} or a default export with tables`,
      );
    }

    const [tableError, tables] = toTableRecord(exportedValue);
    if (tableError) {
      return err("ValidationError", tableError.message);
    }

    return ok(tables);
  } catch (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }
};

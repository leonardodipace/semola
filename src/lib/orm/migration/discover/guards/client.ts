import { isDialect, isModelLike, isTableLike } from "./predicates.js";
import type { LoadedOrm } from "./types.js";
import { buildUrlFromSqlOptions } from "./url.js";

export function fromCreateOrmClient(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const metadata = Reflect.get(value, "__semolaOrm");

  if (typeof metadata === "object" && metadata !== null) {
    const maybeOptions = Reflect.get(metadata, "options");

    if (typeof maybeOptions !== "object" || maybeOptions === null) {
      return null;
    }

    const url = Reflect.get(maybeOptions, "url");

    if (typeof url !== "string") {
      return null;
    }

    const maybeDialect = Reflect.get(metadata, "dialect");

    if (!isDialect(maybeDialect)) {
      return null;
    }

    const maybeTables = Reflect.get(metadata, "tables");

    if (typeof maybeTables !== "object" || maybeTables === null) {
      return null;
    }

    for (const table of Object.values(maybeTables as Record<string, unknown>)) {
      if (!isTableLike(table)) {
        return null;
      }
    }

    const result: LoadedOrm = {
      options: { url },
      dialect: maybeDialect,
      tables: maybeTables as LoadedOrm["tables"],
    };

    return result;
  }

  const tables: LoadedOrm["tables"] = {};
  let dialect: LoadedOrm["dialect"] | null = null;
  let url: string | null = null;

  for (const [key, candidate] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!isModelLike(candidate)) {
      continue;
    }

    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }

    const modelDialect = Reflect.get(candidate, "dialect");
    const modelTable = Reflect.get(candidate, "table");
    const modelSql = Reflect.get(candidate, "sql");

    if (
      modelDialect !== "postgres" &&
      modelDialect !== "mysql" &&
      modelDialect !== "sqlite"
    ) {
      continue;
    }

    if (dialect && dialect !== modelDialect) {
      return null;
    }

    dialect = modelDialect;
    tables[key] = modelTable as LoadedOrm["tables"][string];

    if (!url) {
      url = buildUrlFromSqlOptions(modelSql);
    }
  }

  if (!dialect) {
    return null;
  }

  if (Object.keys(tables).length === 0) {
    return null;
  }

  if (!url) {
    return null;
  }

  return { options: { url }, dialect, tables };
}

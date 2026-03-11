import { relative, resolve } from "node:path";
import { SQL } from "bun";
import { loadConfig } from "../migration/config.js";
import type { Dialect } from "../types.js";
import { generateCode } from "./codegen.js";
import { introspectSchema } from "./index.js";

type IntrospectOptions = {
  cwd?: string;
  output?: string;
  url?: string;
  dialect?: string;
  schema?: string;
};

function inferDialect(url: string): Dialect {
  if (url.includes("mysql")) return "mysql";
  if (url.includes("postgres")) return "postgres";
  return "sqlite";
}

function isDialect(value: string) {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

function parseSchemaFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const db = parsed.pathname.replace(/^\//, "");
    return db || null;
  } catch {
    return null;
  }
}

const defaultOutput = "orm.generated.ts";

async function resolveConfig(cwd: string) {
  try {
    const config = await loadConfig(cwd);
    return config;
  } catch {
    return null;
  }
}

function resolveDbUrl(
  options: IntrospectOptions,
  config: Awaited<ReturnType<typeof resolveConfig>>,
) {
  const dbUrl =
    options.url ??
    config?.orm.introspect.url ??
    process.env.DATABASE_URL ??
    null;

  if (!dbUrl) {
    throw new Error(
      "No database URL found. Pass --url <url> or set DATABASE_URL.",
    );
  }

  return dbUrl;
}

function resolveDialect(
  options: IntrospectOptions,
  config: Awaited<ReturnType<typeof resolveConfig>>,
  dbUrl: string,
): Dialect {
  const rawDialect = options.dialect ?? config?.orm.introspect.dialect ?? null;

  if (!rawDialect) {
    return inferDialect(dbUrl);
  }

  if (!isDialect(rawDialect)) {
    throw new Error(
      `Invalid dialect: "${rawDialect}". Must be postgres, mysql, or sqlite.`,
    );
  }

  return rawDialect;
}

function resolveOutputPath(
  options: IntrospectOptions,
  config: Awaited<ReturnType<typeof resolveConfig>>,
  cwd: string,
) {
  return (
    options.output ??
    config?.orm.introspect.output ??
    resolve(cwd, defaultOutput)
  );
}

function resolveSchema(
  options: IntrospectOptions,
  dialect: Dialect,
  dbUrl: string,
) {
  if (options.schema) {
    return options.schema;
  }

  if (dialect !== "mysql") {
    return null;
  }

  const inferredSchema = parseSchemaFromUrl(dbUrl);

  if (!inferredSchema) {
    throw new Error(
      "Could not determine MySQL schema from URL. Pass --schema <name>.",
    );
  }

  return inferredSchema;
}

export async function runIntrospect(options: IntrospectOptions = {}) {
  const cwd = options.cwd ?? process.cwd();

  const config = await resolveConfig(cwd);
  const dbUrl = resolveDbUrl(options, config);
  const dialect = resolveDialect(options, config, dbUrl);
  const outputPath = resolveOutputPath(options, config, cwd);
  const dbSchema = resolveSchema(options, dialect, dbUrl);

  const sql = new SQL({ url: dbUrl });

  try {
    const tables = await introspectSchema(sql, dialect, {
      schema: dbSchema ?? undefined,
    });

    const code = generateCode(tables, dialect);
    await Bun.write(outputPath, code);

    return {
      configPathRelative: config ? relative(cwd, config.configPath) : null,
      outputPathRelative: relative(cwd, outputPath),
      tableCount: tables.length,
    };
  } finally {
    await sql.close();
  }
}

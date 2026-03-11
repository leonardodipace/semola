import { relative, resolve } from "node:path";
import { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
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

function isDialect(value: string): value is Dialect {
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

export async function runIntrospect(options: IntrospectOptions = {}) {
  const cwd = options.cwd ?? process.cwd();

  const [configErr, config] = await loadConfig(cwd);

  const dbUrl =
    options.url ??
    (!configErr ? config.orm.introspect.url : null) ??
    process.env.DATABASE_URL ??
    null;

  if (!dbUrl) {
    return err(
      "IntrospectError",
      "No database URL found. Pass --url <url> or set DATABASE_URL.",
    );
  }

  const rawDialect =
    options.dialect ??
    (!configErr ? config.orm.introspect.dialect : null) ??
    null;

  let dialect: Dialect;

  if (rawDialect) {
    if (!isDialect(rawDialect)) {
      return err(
        "IntrospectError",
        `Invalid dialect: "${rawDialect}". Must be postgres, mysql, or sqlite.`,
      );
    }
    dialect = rawDialect;
  } else {
    dialect = inferDialect(dbUrl);
  }

  const outputPath =
    options.output ??
    (!configErr ? config.orm.introspect.output : null) ??
    resolve(cwd, defaultOutput);

  let dbSchema = options.schema ?? null;

  if (!dbSchema && dialect === "mysql") {
    dbSchema = parseSchemaFromUrl(dbUrl);

    if (!dbSchema) {
      return err(
        "IntrospectError",
        "Could not determine MySQL schema from URL. Pass --schema <name>.",
      );
    }
  }

  const sql = new SQL({ url: dbUrl });

  const [introspectErr, tables] = await introspectSchema(sql, dialect, {
    schema: dbSchema ?? undefined,
  });

  await mightThrow(sql.close());

  if (introspectErr) {
    return err(introspectErr.type, introspectErr.message);
  }

  const code = generateCode(tables ?? [], dialect);

  const [writeErr] = await mightThrow(Bun.write(outputPath, code));

  if (writeErr) {
    return err(
      "IntrospectError",
      `Failed to write output: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
    );
  }

  const configNote = !configErr ? config.configPath : null;

  return ok({
    configPathRelative: configNote ? relative(cwd, configNote) : null,
    outputPathRelative: relative(cwd, outputPath),
    tableCount: (tables ?? []).length,
  });
}

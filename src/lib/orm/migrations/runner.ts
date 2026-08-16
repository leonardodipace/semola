import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SemolaConfig } from "../../config.js";
import { mightThrow } from "../../errors/index.js";
import { MigrationError } from "../errors.js";
import type { Table } from "../table/types.js";
import { diffSchemas, invertOps } from "./diff.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import { decodeSchemaHeader, renderMigrationSql } from "./sql.js";
import type { LoadedConfig, OrmConfig, SchemaSnapshot } from "./types.js";

const HISTORY_TABLE = "_semola_migrations";

const isOrmClient = (value: unknown) => {
  if (!value) return false;
  if (typeof value !== "object") return false;

  const record = value as Record<string, unknown>;

  if (!record.$config) return false;
  if (!record.$raw) return false;

  return true;
};

export const resolveOrmFromModule = (mod: Record<string, unknown>) => {
  const candidates = [mod.default, ...Object.values(mod)];

  for (const value of candidates) {
    if (!isOrmClient(value)) continue;

    return value as { $config: OrmConfig; $raw: Bun.SQL };
  }

  throw new MigrationError(
    "Schema module must export a createOrm() client (default or named)",
  );
};

const placeholders = (
  adapter: LoadedConfig["orm"]["adapter"],
  count: number,
) => {
  if (adapter === "postgres") {
    return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(
      ", ",
    );
  }

  return Array.from({ length: count }, () => "?").join(", ");
};

export const loadConfig = async (
  cwd = process.cwd(),
): Promise<LoadedConfig> => {
  const configPath = resolve(cwd, "semola.config.ts");
  const [error, mod] = await mightThrow(import(pathToFileURL(configPath).href));

  if (error) {
    throw new MigrationError(
      `Could not load semola.config.ts: ${error.message}`,
    );
  }

  const config = (mod.default ?? mod) as SemolaConfig;

  if (!config?.orm?.schema) {
    throw new MigrationError(
      "semola.config.ts must default-export defineConfig({ orm: { schema } })",
    );
  }

  const schemaPath = resolve(cwd, config.orm.schema);
  const [schemaError, schemaMod] = await mightThrow(
    import(pathToFileURL(schemaPath).href),
  );

  if (schemaError) {
    throw new MigrationError(
      `Could not load schema module: ${schemaError.message}`,
    );
  }

  const client = resolveOrmFromModule(schemaMod as Record<string, unknown>);

  return {
    schemaPath,
    migrationsDir: resolve(cwd, config.orm.migrationsDir ?? "migrations"),
    orm: client.$config,
  };
};

const ensureHistoryTable = async (sql: Bun.SQL) => {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL,
      schema TEXT NOT NULL
    )
  `);
};

const listMigrationDirs = async (migrationsDir: string) => {
  const [error, entries] = await mightThrow(
    readdir(migrationsDir, { withFileTypes: true }),
  );

  if (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return [];
    }

    throw new MigrationError(error.message);
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

const readApplied = async (sql: Bun.SQL) => {
  await ensureHistoryTable(sql);

  const rows = (await sql.unsafe(
    `SELECT name, schema FROM ${HISTORY_TABLE} ORDER BY name ASC`,
  )) as Array<{ name: string; schema: string }>;

  return rows;
};

const latestSchema = (rows: Array<{ schema: string }>): SchemaSnapshot => {
  const last = rows[rows.length - 1];

  if (!last) {
    return emptySchema();
  }

  return JSON.parse(last.schema) as SchemaSnapshot;
};

const slugify = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  if (!slug) {
    throw new MigrationError(`Invalid migration name: ${name}`);
  }

  return slug;
};

const timestamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
};

export const createMigration = async (input: {
  name: string;
  config: LoadedConfig;
}) => {
  const { name, config } = input;
  const sql = new Bun.SQL(config.orm.url, { adapter: config.orm.adapter });

  try {
    const applied = await readApplied(sql);
    const dirs = await listMigrationDirs(config.migrationsDir);
    const appliedNames = new Set(applied.map((row) => row.name));
    const pending = dirs.filter((dir) => !appliedNames.has(dir));

    if (pending.length > 0) {
      throw new MigrationError(
        `Apply pending migrations before creating a new one: ${pending.join(", ")}`,
      );
    }

    const from = latestSchema(applied);
    const to = snapshotSchema(config.orm.tables as Record<string, Table>);
    const ops = diffSchemas(from, to, config.orm.adapter);

    if (ops.length === 0) {
      throw new MigrationError("No schema changes to migrate");
    }

    const folderName = `${timestamp()}_${slugify(name)}`;
    const folderPath = join(config.migrationsDir, folderName);
    const upSql = renderMigrationSql(config.orm.adapter, ops, to);
    const downSql = renderMigrationSql(config.orm.adapter, invertOps(ops));

    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, "up.sql"), upSql);
    await writeFile(join(folderPath, "down.sql"), downSql);

    return folderName;
  } finally {
    await sql.close();
  }
};

const splitStatements = (sqlText: string) => {
  const withoutHeader = sqlText.startsWith("-- semola-schema:")
    ? sqlText.slice(sqlText.indexOf("\n") + 1)
    : sqlText;

  return withoutHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;

      const withoutComments = part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();

      return withoutComments.length > 0;
    });
};

const runSqlFile = async (sql: Bun.SQL, filePath: string) => {
  const text = await readFile(filePath, "utf8");
  const statements = splitStatements(text);

  for (const statement of statements) {
    await sql.unsafe(statement);
  }

  return text;
};

export const applyMigrations = async (config: LoadedConfig) => {
  const sql = new Bun.SQL(config.orm.url, { adapter: config.orm.adapter });

  try {
    const applied = await readApplied(sql);
    const appliedNames = new Set(applied.map((row) => row.name));
    const dirs = await listMigrationDirs(config.migrationsDir);
    const pending = dirs.filter((dir) => !appliedNames.has(dir));

    if (pending.length === 0) {
      return [];
    }

    const appliedNamesList: string[] = [];
    const insertPh = placeholders(config.orm.adapter, 3);

    for (const name of pending) {
      const upPath = join(config.migrationsDir, name, "up.sql");

      await sql.begin(async (tx) => {
        const upText = await runSqlFile(tx, upPath);
        const headerSchema = decodeSchemaHeader(upText);
        const schema =
          headerSchema ??
          snapshotSchema(config.orm.tables as Record<string, Table>);

        await tx.unsafe(
          `INSERT INTO ${HISTORY_TABLE} (name, applied_at, schema) VALUES (${insertPh})`,
          [name, new Date().toISOString(), JSON.stringify(schema)],
        );
      });

      appliedNamesList.push(name);
    }

    return appliedNamesList;
  } finally {
    await sql.close();
  }
};

export const rollbackMigration = async (config: LoadedConfig) => {
  const sql = new Bun.SQL(config.orm.url, { adapter: config.orm.adapter });

  try {
    const applied = await readApplied(sql);
    const last = applied[applied.length - 1];

    if (!last) {
      throw new MigrationError("No migrations to rollback");
    }

    const downPath = join(config.migrationsDir, last.name, "down.sql");
    const deletePh = placeholders(config.orm.adapter, 1);

    await sql.begin(async (tx) => {
      await runSqlFile(tx, downPath);
      await tx.unsafe(`DELETE FROM ${HISTORY_TABLE} WHERE name = ${deletePh}`, [
        last.name,
      ]);
    });

    return last.name;
  } finally {
    await sql.close();
  }
};

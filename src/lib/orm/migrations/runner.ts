import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SemolaConfig } from "../../config.js";
import { mightThrow, mightThrowSync } from "../../errors/index.js";
import { MigrationError } from "../errors.js";
import type { Table } from "../table/types.js";
import type { MigrationDialect } from "./dialect.js";
import { diffSchemas, invertOps } from "./diff.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import { decodeSchemaHeader, getMigrationDialect } from "./sql.js";
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

const resolveOrmFromModule = (mod: Record<string, unknown>) => {
  const candidates = [mod.default, ...Object.values(mod)];

  for (const value of candidates) {
    if (!isOrmClient(value)) continue;

    return value as { $config: OrmConfig; $raw: Bun.SQL };
  }

  throw new MigrationError(
    "Schema module must export a createOrm() client (default or named)",
  );
};

const parseSchema = (raw: string, label: string): SchemaSnapshot => {
  const [error, schema] = mightThrowSync(() => {
    return JSON.parse(raw) as SchemaSnapshot;
  });

  if (error) {
    throw new MigrationError(`Invalid ${label}: ${error.message}`);
  }

  return schema;
};

const withConnection = async <T>(
  config: LoadedConfig,
  fn: (sql: Bun.SQL, dialect: MigrationDialect) => Promise<T>,
) => {
  const dialect = getMigrationDialect(config.orm.adapter);
  const sql = new Bun.SQL(config.orm.url, { adapter: config.orm.adapter });

  try {
    await dialect.prepareConnection(sql);

    return await fn(sql, dialect);
  } finally {
    await sql.close();
  }
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

  try {
    return {
      schemaPath,
      migrationsDir: resolve(cwd, config.orm.migrationsDir ?? "migrations"),
      orm: client.$config,
    };
  } finally {
    await client.$raw.close();
  }
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
    if ("code" in error && error.code === "ENOENT") {
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

  return parseSchema(last.schema, "migration snapshot");
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

  return withConnection(config, async (sql, dialect) => {
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
    const ops = diffSchemas(from, to, dialect.name);

    if (ops.length === 0) {
      throw new MigrationError("No schema changes to migrate");
    }

    const folderName = `${timestamp()}_${slugify(name)}`;
    const folderPath = join(config.migrationsDir, folderName);
    const upSql = dialect.render(ops, to);
    const downSql = dialect.render(invertOps(ops));

    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, "up.sql"), upSql);
    await writeFile(join(folderPath, "down.sql"), downSql);

    return folderName;
  });
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
  return withConnection(config, async (sql, dialect) => {
    const applied = await readApplied(sql);
    const appliedNames = new Set(applied.map((row) => row.name));
    const dirs = await listMigrationDirs(config.migrationsDir);
    const pending = dirs.filter((dir) => !appliedNames.has(dir));

    if (pending.length === 0) {
      return [];
    }

    const appliedNamesList: string[] = [];
    const insertPh = dialect.placeholders(3);

    for (const name of pending) {
      const upPath = join(config.migrationsDir, name, "up.sql");

      await sql.begin(async (tx) => {
        const upText = await runSqlFile(tx, upPath);
        const headerSchema = decodeSchemaHeader(upText);

        if (!headerSchema) {
          throw new MigrationError(
            `Migration ${name} is missing a schema header`,
          );
        }

        await tx.unsafe(
          `INSERT INTO ${HISTORY_TABLE} (name, applied_at, schema) VALUES (${insertPh})`,
          [name, new Date().toISOString(), JSON.stringify(headerSchema)],
        );
      });

      appliedNamesList.push(name);
    }

    return appliedNamesList;
  });
};

export const rollbackMigration = async (config: LoadedConfig) => {
  return withConnection(config, async (sql, dialect) => {
    const applied = await readApplied(sql);
    const last = applied[applied.length - 1];

    if (!last) {
      throw new MigrationError("No migrations to rollback");
    }

    const downPath = join(config.migrationsDir, last.name, "down.sql");
    const deletePh = dialect.placeholders(1);

    await sql.begin(async (tx) => {
      await runSqlFile(tx, downPath);
      await tx.unsafe(`DELETE FROM ${HISTORY_TABLE} WHERE name = ${deletePh}`, [
        last.name,
      ]);
    });

    return last.name;
  });
};

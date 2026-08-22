import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SemolaConfig } from "../../config.js";
import { mightThrow, mightThrowSync } from "../../errors/index.js";
import { MigrationError } from "../errors.js";
import { getOrmConnectionUrl } from "../orm/orm.js";
import type { MigrationDialect } from "./dialect/index.js";
import { getMigrationDialect } from "./dialect/index.js";
import { diffSchemas } from "./diff.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import {
  assertSchemaSnapshot,
  decodeSchemaHeader,
  splitStatements,
} from "./sql.js";
import type { LoadedConfig, OrmConfig } from "./types.js";

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

const parseSchema = (raw: string, label: string) => {
  const [error, parsed] = mightThrowSync(() => {
    return JSON.parse(raw) as unknown;
  });

  if (error) {
    throw new MigrationError(`Invalid ${label}: ${error.message}`);
  }

  return assertSchemaSnapshot(parsed, label);
};

const importModule = async (filePath: string, label: string) => {
  const [error, mod] = await mightThrow(import(pathToFileURL(filePath).href));

  if (error) {
    throw new MigrationError(`Could not load ${label}: ${error.message}`);
  }

  return mod;
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

export const loadConfig = async (cwd = process.cwd()) => {
  const configPath = resolve(cwd, "semola.config.ts");
  const mod = await importModule(configPath, "semola.config.ts");
  const config = (mod.default ?? mod) as SemolaConfig;

  if (!config.orm?.schema) {
    throw new MigrationError(
      "semola.config.ts must default-export defineConfig({ orm: { schema } })",
    );
  }

  const schemaPath = resolve(cwd, config.orm.schema);
  const schemaMod = await importModule(schemaPath, "schema module");
  const client = resolveOrmFromModule(schemaMod as Record<string, unknown>);
  const url = getOrmConnectionUrl(client) ?? client.$config.url;

  await client.$raw.close();

  return {
    migrationsDir: resolve(cwd, config.orm.migrationsDir ?? "migrations"),
    orm: {
      adapter: client.$config.adapter,
      url,
      tables: client.$config.tables,
    },
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

const assertHistoryMatchesFiles = (
  dirs: string[],
  applied: Array<{ name: string }>,
) => {
  for (let index = 0; index < applied.length; index++) {
    const expected = dirs[index];
    const actual = applied[index]?.name;

    if (expected === actual) continue;

    if (!expected) {
      throw new MigrationError(
        `Applied migration ${actual} is missing from the migrations directory`,
      );
    }

    throw new MigrationError(
      `Migration history does not match files: expected ${expected} at position ${index}, found ${actual}`,
    );
  }
};

const readApplied = async (sql: Bun.SQL) => {
  await ensureHistoryTable(sql);

  const rows = (await sql.unsafe(
    `SELECT name, schema FROM ${HISTORY_TABLE} ORDER BY name ASC`,
  )) as Array<{ name: string; schema: string }>;

  return rows;
};

const latestSchema = (rows: Array<{ schema: string }>) => {
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
    String(now.getUTCMilliseconds()).padStart(3, "0"),
  ].join("");
};

const loadHistory = async (sql: Bun.SQL, migrationsDir: string) => {
  const applied = await readApplied(sql);
  const dirs = await listMigrationDirs(migrationsDir);

  assertHistoryMatchesFiles(dirs, applied);

  return { applied, dirs };
};

const pendingDirs = (applied: Array<{ name: string }>, dirs: string[]) => {
  const appliedNames = new Set(applied.map((row) => row.name));

  return dirs.filter((dir) => !appliedNames.has(dir));
};

export const createMigration = async (input: {
  name: string;
  config: LoadedConfig;
}) => {
  const { name, config } = input;

  return withConnection(config, async (sql, dialect) => {
    const { applied, dirs } = await loadHistory(sql, config.migrationsDir);
    const pending = pendingDirs(applied, dirs);

    if (pending.length > 0) {
      throw new MigrationError(
        `Apply pending migrations before creating a new one: ${pending.join(", ")}`,
      );
    }

    const from = latestSchema(applied);
    const to = snapshotSchema(config.orm.tables);
    const ops = diffSchemas(from, to, dialect);

    if (ops.length === 0) {
      throw new MigrationError("No schema changes to migrate");
    }

    const folderName = `${timestamp()}_${slugify(name)}`;
    const folderPath = join(config.migrationsDir, folderName);
    const upSql = dialect.render(ops, to);

    if (splitStatements(upSql).length === 0) {
      throw new MigrationError("No schema changes to migrate");
    }

    const downSql = dialect.render(
      diffSchemas(to, from, dialect, { strictAddColumn: false }),
    );

    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, "up.sql"), upSql);
    await writeFile(join(folderPath, "down.sql"), downSql);

    return folderName;
  });
};

const readSqlFile = async (filePath: string, label: string) => {
  const [error, text] = await mightThrow(readFile(filePath, "utf8"));

  if (error) {
    throw new MigrationError(`Could not read ${label}: ${error.message}`);
  }

  return text;
};

const runSqlFile = async (
  sql: Bun.SQL,
  filePath: string,
  label: string,
  requireHeader: boolean,
) => {
  const text = await readSqlFile(filePath, label);
  const headerSchema = decodeSchemaHeader(text);
  const statements = splitStatements(text);

  if (requireHeader) {
    if (!headerSchema) {
      throw new MigrationError(`${label} is missing a schema header`);
    }

    if (statements.length === 0) {
      throw new MigrationError(`${label} has no SQL statements to apply`);
    }
  }

  for (const statement of statements) {
    await sql.unsafe(statement);
  }

  return headerSchema;
};

export const applyMigrations = async (config: LoadedConfig) => {
  return withConnection(config, async (sql, dialect) => {
    const { applied, dirs } = await loadHistory(sql, config.migrationsDir);
    const pending = pendingDirs(applied, dirs);

    if (pending.length === 0) {
      return [];
    }

    const insertPh = dialect.placeholders(3);
    const appliedNames: string[] = [];

    for (const name of pending) {
      const upPath = join(config.migrationsDir, name, "up.sql");

      await dialect.beginMigration(sql, async (tx) => {
        await dialect.lockMigrations(tx);

        const appliedNow = await readApplied(tx);

        assertHistoryMatchesFiles(dirs, appliedNow);

        if (appliedNow.some((row) => row.name === name)) {
          return;
        }

        if (dirs[appliedNow.length] !== name) {
          throw new MigrationError(
            `Migration ${name} is not next to apply after lock`,
          );
        }

        const headerSchema = await runSqlFile(
          tx,
          upPath,
          `Migration ${name}`,
          true,
        );

        await dialect.assertForeignKeys(tx);

        await tx.unsafe(
          `INSERT INTO ${HISTORY_TABLE} (name, applied_at, schema) VALUES (${insertPh})`,
          [name, new Date().toISOString(), JSON.stringify(headerSchema)],
        );

        appliedNames.push(name);
      });
    }

    return appliedNames;
  });
};

export const rollbackMigration = async (config: LoadedConfig) => {
  return withConnection(config, async (sql, dialect) => {
    const { applied } = await loadHistory(sql, config.migrationsDir);
    const last = applied[applied.length - 1];

    if (!last) {
      throw new MigrationError("No migrations to rollback");
    }

    const downPath = join(config.migrationsDir, last.name, "down.sql");
    const deletePh = dialect.placeholders(1);

    await dialect.beginMigration(sql, async (tx) => {
      await dialect.lockMigrations(tx);
      await runSqlFile(tx, downPath, `Migration ${last.name} down.sql`, false);
      await dialect.assertForeignKeys(tx);
      await tx.unsafe(`DELETE FROM ${HISTORY_TABLE} WHERE name = ${deletePh}`, [
        last.name,
      ]);
    });

    return last.name;
  });
};

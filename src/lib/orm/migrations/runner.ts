import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SemolaConfig } from "../../config.js";
import { mightThrow, mightThrowSync } from "../../errors/index.js";
import { MigrationError } from "../errors.js";
import { getOrmConnectionUrl } from "../orm/orm.js";
import type { Table } from "../table/types.js";
import type { MigrationDialect } from "./dialect.js";
import { diffSchemas } from "./diff.js";
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
  const url = getOrmConnectionUrl(config.orm.tables) ?? config.orm.url;
  const sql = new Bun.SQL(url, { adapter: config.orm.adapter });

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

  if (!config.orm?.schema) {
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
  const result = {
    schemaPath,
    migrationsDir: resolve(cwd, config.orm.migrationsDir ?? "migrations"),
    orm: {
      ...client.$config,
      url: getOrmConnectionUrl(client) ?? client.$config.url,
    },
  };

  await client.$raw.close();

  return result;
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

    if (!actual) {
      throw new MigrationError(
        `Migration history is missing ${expected} (files and _semola_migrations are out of order)`,
      );
    }

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
    const to = snapshotSchema(config.orm.tables as Record<string, Table>);
    const ops = diffSchemas(from, to, dialect.name);

    if (ops.length === 0) {
      throw new MigrationError("No schema changes to migrate");
    }

    const folderName = `${timestamp()}_${slugify(name)}`;
    const folderPath = join(config.migrationsDir, folderName);
    const upSql = dialect.render(ops, to);
    const downSql = dialect.render(
      diffSchemas(to, from, dialect.name, { strictAddColumn: false }),
    );

    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, "up.sql"), upSql);
    await writeFile(join(folderPath, "down.sql"), downSql);

    return folderName;
  });
};

const closeQuote = (text: string, start: number, quote: string) => {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] !== quote) continue;
    if (text[index + 1] === quote) {
      index += 1;
      continue;
    }

    return index;
  }

  return text.length - 1;
};

const takeUntil = (text: string, start: number, end: number) => {
  return {
    chunk: text.slice(start, end + 1),
    next: end,
  };
};

const takeQuoted = (text: string, start: number) => {
  return takeUntil(text, start, closeQuote(text, start, text[start] ?? ""));
};

const takeLineComment = (text: string, start: number) => {
  const newline = text.indexOf("\n", start);
  const end = newline === -1 ? text.length : newline;

  return takeUntil(text, start, end - 1);
};

const takeBlockComment = (text: string, start: number) => {
  const end = text.indexOf("*/", start + 2);

  if (end === -1) {
    return takeUntil(text, start, text.length - 1);
  }

  return takeUntil(text, start, end + 1);
};

const takeDollarQuote = (text: string, start: number) => {
  let tagEnd = start + 1;

  if (text[tagEnd] === "$") {
    tagEnd += 1;
  } else {
    if (!/[A-Za-z_]/.test(text[tagEnd] ?? "")) {
      return undefined;
    }

    tagEnd += 1;

    while (/[A-Za-z0-9_]/.test(text[tagEnd] ?? "")) {
      tagEnd += 1;
    }

    if (text[tagEnd] !== "$") {
      return undefined;
    }

    tagEnd += 1;
  }

  const tag = text.slice(start, tagEnd);
  const close = text.indexOf(tag, tagEnd);

  if (close === -1) {
    return takeUntil(text, start, text.length - 1);
  }

  return takeUntil(text, start, close + tag.length - 1);
};

const isSqlStatement = (text: string) => {
  return (
    text
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim().length > 0
  );
};

const takeSpecial = (source: string, index: number) => {
  const char = source[index] ?? "";
  const next = source[index + 1] ?? "";

  if (char === "'" || char === '"') {
    return takeQuoted(source, index);
  }

  if (char === "-" && next === "-") {
    return takeLineComment(source, index);
  }

  if (char === "/" && next === "*") {
    return takeBlockComment(source, index);
  }

  if (char === "$") {
    return takeDollarQuote(source, index);
  }

  return undefined;
};

const flushStatement = (current: string, statements: string[]) => {
  const trimmed = current.trim();

  if (!trimmed) return "";
  if (!isSqlStatement(trimmed)) return "";

  statements.push(trimmed);

  return "";
};

export const splitStatements = (sqlText: string) => {
  const source = sqlText.startsWith("-- semola-schema:")
    ? sqlText.slice(sqlText.indexOf("\n") + 1)
    : sqlText;

  const statements: string[] = [];
  let current = "";

  for (let index = 0; index < source.length; index++) {
    const taken = takeSpecial(source, index);

    if (taken) {
      current += taken.chunk;
      index = taken.next;
      continue;
    }

    if (source[index] === ";") {
      current = flushStatement(current, statements);
      continue;
    }

    current += source[index] ?? "";
  }

  flushStatement(current, statements);

  return statements;
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

  if (requireHeader) {
    if (!headerSchema) {
      throw new MigrationError(`${label} is missing a schema header`);
    }
  }

  const statements = splitStatements(text);

  for (const statement of statements) {
    await sql.unsafe(statement);
  }

  return { text, headerSchema };
};

export const applyMigrations = async (config: LoadedConfig) => {
  return withConnection(config, async (sql, dialect) => {
    const { applied, dirs } = await loadHistory(sql, config.migrationsDir);
    const pending = pendingDirs(applied, dirs);

    if (pending.length === 0) {
      return [];
    }

    const appliedNamesList: string[] = [];
    const insertPh = dialect.placeholders(3);

    for (const name of pending) {
      const upPath = join(config.migrationsDir, name, "up.sql");

      await dialect.beginMigration(sql, async (tx) => {
        await dialect.lockMigrations(tx);

        const { headerSchema } = await runSqlFile(
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
      });

      appliedNamesList.push(name);
    }

    return appliedNamesList;
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

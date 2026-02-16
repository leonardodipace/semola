import { resolve } from "node:path";
import { err, ok } from "../../errors/index.js";
import type { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
import { SchemaBuilder } from "./builder.js";
import { diffSnapshots, reverseOperations } from "./diff.js";
import { loadMigration, scanMigrationFiles } from "./files.js";
import { generateMigrationSource, writeMigrationSource } from "./generator.js";
import {
  addJournalEntry,
  getLastEntry,
  readJournal,
  removeLastJournalEntry,
  writeJournal,
} from "./journal.js";
import { createSnapshot, readSnapshot, writeSnapshot } from "./snapshot.js";
import {
  ensureMigrationsTable,
  getAppliedMigrations,
  recordMigration,
  removeMigration,
} from "./state.js";
import type { MigrationCreateOptions, MigrationStatus } from "./types.js";

const slugify = (value: string) => {
  const lowered = value.trim().toLowerCase();
  const parts: string[] = [];
  let current = "";

  for (const ch of lowered) {
    const isLowerAlpha = ch >= "a" && ch <= "z";
    const isDigit = ch >= "0" && ch <= "9";

    if (isLowerAlpha || isDigit) {
      current += ch;
      continue;
    }

    if (current.length > 0) {
      parts.push(current);
      current = "";
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts.join("_");
};

const timestamp = () => {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

type MigrationRuntimeOptions = {
  orm: Orm<Record<string, Table>>;
  migrationsDir?: string;
  migrationTable?: string;
};

const getRuntimeContext = (options: MigrationRuntimeOptions) => {
  return {
    orm: options.orm,
    migrationsDir: options.migrationsDir ?? `${process.cwd()}/migrations`,
    migrationTable: options.migrationTable ?? "semola_migrations",
  };
};

const runInTransaction = async (
  orm: Orm<Record<string, Table>>,
  run: () => Promise<void>,
) => {
  await orm.sql.begin(async () => {
    await run();
  });
};

export const createMigration = async (
  options: MigrationRuntimeOptions & {
    name: string;
    tables: Record<string, Table>;
  },
) => {
  const runtime = getRuntimeContext(options);
  const migrationsDir = runtime.migrationsDir;
  const metaDir = resolve(migrationsDir, "meta");

  // Ensure directories exist
  await Bun.write(resolve(migrationsDir, ".keep"), "");
  await Bun.write(resolve(metaDir, ".keep"), "");

  const safeName = slugify(options.name);
  if (safeName.length === 0) {
    return err("ValidationError", "Migration name cannot be empty");
  }

  // Create snapshot of current schema
  const newSnapshot = createSnapshot(
    options.tables,
    runtime.orm.getDialectName(),
  );

  // Read journal to find last snapshot
  const [journalError, journalResult] = await readJournal(
    resolve(metaDir, "_journal.json"),
  );
  if (journalError) {
    return err(
      "InternalServerError",
      journalError instanceof Error
        ? journalError.message
        : String(journalError),
    );
  }
  const journal = journalResult ?? { version: 1, entries: [] };
  const lastEntry = getLastEntry(journal);

  // Read last snapshot if it exists
  let lastSnapshot = null;
  if (lastEntry) {
    const [snapshotError, snapshot] = await readSnapshot(
      resolve(metaDir, `${lastEntry.version}_snapshot.json`),
    );
    if (snapshotError) {
      return err(
        "InternalServerError",
        snapshotError instanceof Error
          ? snapshotError.message
          : String(snapshotError),
      );
    }
    lastSnapshot = snapshot;
  }

  // Generate diff operations
  const up = diffSnapshots(lastSnapshot, newSnapshot);
  const down = reverseOperations(up);

  if (up.length === 0) {
    return err("ValidationError", "No schema changes detected");
  }

  // Generate migration file
  const version = timestamp();
  const filePath = resolve(migrationsDir, `${version}_${safeName}.ts`);
  const source = generateMigrationSource(up, down);
  await writeMigrationSource(filePath, source);

  // Save snapshot
  const snapshotPath = resolve(metaDir, `${version}_snapshot.json`);
  await writeSnapshot(snapshotPath, newSnapshot);

  // Update journal
  const updatedJournal = addJournalEntry(journal, {
    version,
    name: safeName,
    applied: new Date().toISOString(),
    breakpoints: false,
  });
  await writeJournal(resolve(metaDir, "_journal.json"), updatedJournal);

  return ok(filePath);
};

export const applyMigrations = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  await ensureMigrationsTable(runtime.orm, runtime.migrationTable);
  const files = await scanMigrationFiles(runtime.migrationsDir);
  const applied = await getAppliedMigrations(
    runtime.orm,
    runtime.migrationTable,
  );
  const appliedVersions = new Set(applied.map((item) => item.version));
  const pending = files.filter((file) => !appliedVersions.has(file.version));
  const result: string[] = [];

  for (const file of pending) {
    const [migrationError, migration] = await loadMigration(file);
    if (migrationError) {
      return err(
        "InternalServerError",
        migrationError instanceof Error
          ? migrationError.message
          : String(migrationError),
      );
    }
    if (!migration) {
      return err("InternalServerError", "Failed to load migration");
    }
    const schema = new SchemaBuilder(runtime.orm, runtime.orm.getDialectName());

    await runInTransaction(runtime.orm, async () => {
      await migration.up(schema);
      await recordMigration(
        runtime.orm,
        runtime.migrationTable,
        migration.version,
        migration.name,
      );
    });

    result.push(migration.version);
  }

  return ok(result);
};

export const rollbackMigration = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  await ensureMigrationsTable(runtime.orm, runtime.migrationTable);
  const files = await scanMigrationFiles(runtime.migrationsDir);
  const applied = await getAppliedMigrations(
    runtime.orm,
    runtime.migrationTable,
  );

  if (applied.length === 0) {
    return ok(null);
  }

  const latestApplied = applied[applied.length - 1];
  if (!latestApplied) {
    return ok(null);
  }

  const file = files.find((entry) => entry.version === latestApplied.version);

  if (!file) {
    return err(
      "NotFoundError",
      `Missing migration file for version ${latestApplied.version}`,
    );
  }

  const [migrationError, migration] = await loadMigration(file);
  if (migrationError) {
    return err(
      "InternalServerError",
      migrationError instanceof Error
        ? migrationError.message
        : String(migrationError),
    );
  }
  if (!migration) {
    return err("InternalServerError", "Failed to load migration");
  }
  const schema = new SchemaBuilder(runtime.orm, runtime.orm.getDialectName());

  await runInTransaction(runtime.orm, async () => {
    await migration.down(schema);
    await removeMigration(
      runtime.orm,
      runtime.migrationTable,
      migration.version,
    );
  });

  // Update journal
  const metaDir = resolve(runtime.migrationsDir, "meta");
  const [journalError, journalResult] = await readJournal(
    resolve(metaDir, "_journal.json"),
  );
  if (journalError) {
    return err(
      "InternalServerError",
      journalError instanceof Error
        ? journalError.message
        : String(journalError),
    );
  }
  const journal = journalResult ?? { version: 1, entries: [] };
  const updatedJournal = removeLastJournalEntry(journal);
  await writeJournal(resolve(metaDir, "_journal.json"), updatedJournal);

  return ok(migration.version);
};

export const getMigrationStatus = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  await ensureMigrationsTable(runtime.orm, runtime.migrationTable);
  const files = await scanMigrationFiles(runtime.migrationsDir);
  const applied = await getAppliedMigrations(
    runtime.orm,
    runtime.migrationTable,
  );
  const appliedMap = new Map(
    applied.map((item) => [item.version, item.appliedAt] as const),
  );

  const statuses: MigrationStatus[] = files.map((file) => {
    const appliedAt = appliedMap.get(file.version) ?? null;
    return {
      version: file.version,
      name: file.name,
      applied: appliedAt !== null,
      appliedAt,
    };
  });

  return ok(statuses);
};

export type { MigrationCreateOptions, MigrationRuntimeOptions };

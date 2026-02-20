import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { err, mightThrow, ok } from "../../errors/index.js";
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

const timestampWithMilliseconds = () => {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
};

const VERSION_COUNTER_DIGITS = 3;

let lastTimestampBase = "";
let lastTimestampCounter = 0;

const incrementVersion = (value: string) => {
  const next = BigInt(value) + 1n;
  return String(next).padStart(value.length, "0");
};

const createMigrationVersion = (lastVersion: string | null) => {
  const timestampBase = timestampWithMilliseconds();

  let counter = 0;
  if (timestampBase === lastTimestampBase) {
    counter = lastTimestampCounter + 1;
  }

  let version = `${timestampBase}${String(counter).padStart(VERSION_COUNTER_DIGITS, "0")}`;

  if (lastVersion && version <= lastVersion) {
    version = incrementVersion(lastVersion);
  }

  lastTimestampBase = version.slice(0, timestampBase.length);
  const parsedCounter = Number(version.slice(-VERSION_COUNTER_DIGITS));
  if (Number.isNaN(parsedCounter)) {
    lastTimestampCounter = 0;
  } else {
    lastTimestampCounter = parsedCounter;
  }

  return version;
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
  run: (
    tx: Bun.SQL,
  ) => Promise<readonly [{ type: string; message: string } | null, unknown]>,
) => {
  const [error] = await mightThrow(
    orm.sql.begin(async (tx) => {
      const [runError] = await run(tx);
      if (runError) {
        throw new Error(runError.message);
      }
    }),
  );

  if (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }

  return ok(undefined);
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
  const [migrationsDirError] = await mightThrow(
    Bun.write(resolve(migrationsDir, ".keep"), ""),
  );
  if (migrationsDirError) {
    return err(
      "InternalServerError",
      `Failed to create migration directories: ${migrationsDirError instanceof Error ? migrationsDirError.message : String(migrationsDirError)}`,
    );
  }

  const [metaDirError] = await mightThrow(
    Bun.write(resolve(metaDir, ".keep"), ""),
  );
  if (metaDirError) {
    return err(
      "InternalServerError",
      `Failed to create migration directories: ${metaDirError instanceof Error ? metaDirError.message : String(metaDirError)}`,
    );
  }

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
  const [journalError, journalData] = await readJournal(
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
  const journal = journalData ?? { version: 1, entries: [] };
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
  const [reverseError, down] = reverseOperations(up);

  if (reverseError) {
    return err(
      "InternalServerError",
      `Failed to generate down migration: ${reverseError.message}`,
    );
  }

  if (up.length === 0) {
    return err("ValidationError", "No schema changes detected");
  }

  // Generate migration file
  const version = createMigrationVersion(lastEntry?.version ?? null);
  const filePath = resolve(migrationsDir, `${version}_${safeName}.ts`);
  const source = generateMigrationSource(up, down);
  const writeResult = await writeMigrationSource(filePath, source);

  if (writeResult[0]) {
    return writeResult;
  }

  // Save snapshot with rollback on failure
  const snapshotPath = resolve(metaDir, `${version}_snapshot.json`);
  const snapshotResult = await writeSnapshot(snapshotPath, newSnapshot);
  if (snapshotResult[0]) {
    // Rollback: delete migration file
    await mightThrow(unlink(filePath));
    return err(
      "InternalServerError",
      snapshotResult[0] instanceof Error
        ? snapshotResult[0].message
        : String(snapshotResult[0]),
    );
  }

  // Update journal with rollback on failure
  const updatedJournal = addJournalEntry(journal, {
    version,
    name: safeName,
    applied: new Date().toISOString(),
    breakpoints: false,
  });
  const journalResult = await writeJournal(
    resolve(metaDir, "_journal.json"),
    updatedJournal,
  );
  if (journalResult[0]) {
    // Rollback: delete both snapshot and migration file
    await mightThrow(unlink(snapshotPath));
    await mightThrow(unlink(filePath));
    return err(
      "InternalServerError",
      journalResult[0] instanceof Error
        ? journalResult[0].message
        : String(journalResult[0]),
    );
  }

  return ok(filePath);
};

export const applyMigrations = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  const [ensureError] = await ensureMigrationsTable(
    runtime.orm,
    runtime.migrationTable,
  );
  if (ensureError) {
    return err(ensureError.type, ensureError.message);
  }

  const [filesError, files] = await scanMigrationFiles(runtime.migrationsDir);
  if (filesError) {
    return err(
      "InternalServerError",
      `Failed to scan migration files: ${filesError?.message ?? "Unknown error"}`,
    );
  }
  if (!files) {
    return err("InternalServerError", "Failed to scan migration files");
  }

  const [appliedError, applied] = await getAppliedMigrations(
    runtime.orm,
    runtime.migrationTable,
  );
  if (appliedError) {
    return err(appliedError.type, appliedError.message);
  }
  const appliedVersions = new Set(applied.map((item) => item.version));
  const pending = files.filter((file) => !appliedVersions.has(file.version));
  const result: string[] = [];

  for (const file of pending) {
    const [migrationError, migration] = await loadMigration(file);
    if (migrationError) {
      return err("InternalServerError", migrationError.message);
    }
    if (!migration) {
      return err("InternalServerError", "Failed to load migration");
    }
    const [txError] = await runInTransaction(runtime.orm, async (tx) => {
      const schema = new SchemaBuilder(
        runtime.orm,
        runtime.orm.getDialectName(),
        tx,
      );
      await migration.up(schema);
      const [recordError] = await recordMigration(
        runtime.orm,
        runtime.migrationTable,
        migration.version,
        migration.name,
        tx,
      );
      if (recordError) {
        return err(recordError.type, recordError.message);
      }

      return ok(undefined);
    });

    if (txError) {
      return err(
        "InternalServerError",
        `Failed to apply migration ${migration.version}: ${txError.message}`,
      );
    }

    result.push(migration.version);
  }

  return ok(result);
};

export const rollbackMigration = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  const [ensureError] = await ensureMigrationsTable(
    runtime.orm,
    runtime.migrationTable,
  );
  if (ensureError) {
    return err(ensureError.type, ensureError.message);
  }

  const [filesError, files] = await scanMigrationFiles(runtime.migrationsDir);
  if (filesError || !files) {
    return err(
      "InternalServerError",
      `Failed to scan migration files: ${filesError?.message ?? "Unknown error"}`,
    );
  }

  const [appliedError, applied] = await getAppliedMigrations(
    runtime.orm,
    runtime.migrationTable,
  );
  if (appliedError) {
    return err(appliedError.type, appliedError.message);
  }

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
  const [txError] = await runInTransaction(runtime.orm, async (tx) => {
    const schema = new SchemaBuilder(
      runtime.orm,
      runtime.orm.getDialectName(),
      tx,
    );
    await migration.down(schema);
    const [removeError] = await removeMigration(
      runtime.orm,
      runtime.migrationTable,
      migration.version,
      tx,
    );
    if (removeError) {
      return err(removeError.type, removeError.message);
    }

    return ok(undefined);
  });

  if (txError) {
    return err(
      "InternalServerError",
      `Failed to rollback migration ${migration.version}: ${txError.message}`,
    );
  }

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
  const writeJournalResult = await writeJournal(
    resolve(metaDir, "_journal.json"),
    updatedJournal,
  );
  if (writeJournalResult[0]) {
    return err(
      "InternalServerError",
      `Failed to update journal after rollback: ${
        writeJournalResult[0] instanceof Error
          ? writeJournalResult[0].message
          : String(writeJournalResult[0])
      }`,
    );
  }

  return ok(migration.version);
};

export const getMigrationStatus = async (options: MigrationRuntimeOptions) => {
  const runtime = getRuntimeContext(options);

  const [ensureError] = await ensureMigrationsTable(
    runtime.orm,
    runtime.migrationTable,
  );
  if (ensureError) {
    return err(ensureError.type, ensureError.message);
  }

  const [filesError, files] = await scanMigrationFiles(runtime.migrationsDir);
  if (filesError || !files) {
    return err(
      "InternalServerError",
      `Failed to scan migration files: ${filesError?.message ?? "Unknown error"}`,
    );
  }

  const [appliedError, applied] = await getAppliedMigrations(
    runtime.orm,
    runtime.migrationTable,
  );
  if (appliedError) {
    return err(appliedError.type, appliedError.message);
  }
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

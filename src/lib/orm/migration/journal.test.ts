import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addJournalEntry,
  getLastEntry,
  type Journal,
  type JournalEntry,
  readJournal,
  removeLastJournalEntry,
  writeJournal,
} from "./journal.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "semola-journal-"));
  tempDirs.push(dir);
  return dir;
};

describe("readJournal", () => {
  test("returns empty journal when file does not exist", async () => {
    const [error, journal] = await readJournal(
      "/tmp/non-existent-journal.json",
    );

    expect(error).toBeNull();
    expect(journal).not.toBeNull();
    expect(journal?.version).toBe(1);
    expect(journal?.entries).toEqual([]);
  });

  test("returns error for invalid journal format", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-journal.json");
    await Bun.write(tempFile, JSON.stringify({ invalid: "format" }));

    const [error, journal] = await readJournal(tempFile);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("Invalid journal format");
    expect(journal).toBeNull();
  });

  test("returns error for invalid JSON", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-journal.json");
    await Bun.write(tempFile, "{ invalid json }");

    const [error, journal] = await readJournal(tempFile);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("InternalServerError");
    expect(journal).toBeNull();
  });

  test("returns valid journal when file is valid", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-journal.json");
    const validJournal: Journal = {
      version: 1,
      entries: [
        {
          version: "20260216120000",
          name: "initial",
          applied: "2026-02-16T12:00:00.000Z",
          breakpoints: false,
        },
      ],
    };
    await Bun.write(tempFile, JSON.stringify(validJournal));

    const [error, journal] = await readJournal(tempFile);

    expect(error).toBeNull();
    expect(journal).not.toBeNull();
    expect(journal?.version).toBe(1);
    expect(journal?.entries.length).toBe(1);
    expect(journal?.entries[0]?.version).toBe("20260216120000");
  });
});

describe("writeJournal", () => {
  test("writes journal successfully", async () => {
    const dir = await createTempDir();
    const tempFile = join(dir, "test-journal.json");
    const journal: Journal = {
      version: 1,
      entries: [],
    };

    const [error, result] = await writeJournal(tempFile, journal);

    expect(error).toBeNull();
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);

    const file = Bun.file(tempFile);
    expect(await file.exists()).toBe(true);
  });

  test("returns error tuple on failure", async () => {
    const [error, result] = await writeJournal("/invalid/path/journal.json", {
      version: 1,
      entries: [],
    });

    expect(error).not.toBeNull();
    expect(result).toBeNull();
  });
});

describe("addJournalEntry", () => {
  test("adds entry to empty journal", () => {
    const journal: Journal = {
      version: 1,
      entries: [],
    };
    const entry: JournalEntry = {
      version: "20260216120000",
      name: "initial",
      applied: "2026-02-16T12:00:00.000Z",
      breakpoints: false,
    };

    const updated = addJournalEntry(journal, entry);

    expect(updated.entries.length).toBe(1);
    expect(updated.entries[0]).toEqual(entry);
  });

  test("adds entry to existing journal", () => {
    const journal: Journal = {
      version: 1,
      entries: [
        {
          version: "20260216120000",
          name: "first",
          applied: "2026-02-16T12:00:00.000Z",
          breakpoints: false,
        },
      ],
    };
    const entry: JournalEntry = {
      version: "20260216120100",
      name: "second",
      applied: "2026-02-16T12:01:00.000Z",
      breakpoints: false,
    };

    const updated = addJournalEntry(journal, entry);

    expect(updated.entries.length).toBe(2);
    expect(updated.entries[1]).toEqual(entry);
  });
});

describe("removeLastJournalEntry", () => {
  test("removes last entry from journal", () => {
    const journal: Journal = {
      version: 1,
      entries: [
        {
          version: "20260216120000",
          name: "first",
          applied: "2026-02-16T12:00:00.000Z",
          breakpoints: false,
        },
        {
          version: "20260216120100",
          name: "second",
          applied: "2026-02-16T12:01:00.000Z",
          breakpoints: false,
        },
      ],
    };

    const updated = removeLastJournalEntry(journal);

    expect(updated.entries.length).toBe(1);
    expect(updated.entries[0]?.name).toBe("first");
  });

  test("returns empty entries for empty journal", () => {
    const journal: Journal = {
      version: 1,
      entries: [],
    };

    const updated = removeLastJournalEntry(journal);

    expect(updated.entries.length).toBe(0);
  });
});

describe("getLastEntry", () => {
  test("returns last entry from journal", () => {
    const journal: Journal = {
      version: 1,
      entries: [
        {
          version: "20260216120000",
          name: "first",
          applied: "2026-02-16T12:00:00.000Z",
          breakpoints: false,
        },
        {
          version: "20260216120100",
          name: "second",
          applied: "2026-02-16T12:01:00.000Z",
          breakpoints: false,
        },
      ],
    };

    const last = getLastEntry(journal);

    expect(last).not.toBeNull();
    expect(last?.name).toBe("second");
  });

  test("returns null for empty journal", () => {
    const journal: Journal = {
      version: 1,
      entries: [],
    };

    const last = getLastEntry(journal);

    expect(last).toBeNull();
  });
});

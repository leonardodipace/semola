import { err, ok } from "../../errors/index.js";

export type JournalEntry = {
  version: string;
  name: string;
  applied: string;
  breakpoints: boolean;
};

export type Journal = {
  version: number;
  entries: JournalEntry[];
};

const createEmptyJournal = (): Journal => {
  return {
    version: 1,
    entries: [],
  };
};

export const readJournal = async (filePath: string) => {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return ok(createEmptyJournal());
  }

  try {
    const content = await file.text();
    const journal = JSON.parse(content);

    // Basic validation
    if (
      typeof journal !== "object" ||
      journal === null ||
      typeof journal.version !== "number" ||
      !Array.isArray(journal.entries)
    ) {
      return err("ValidationError", `Invalid journal format in ${filePath}`);
    }

    return ok(journal);
  } catch (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const writeJournal = async (filePath: string, journal: Journal) => {
  return Bun.write(filePath, JSON.stringify(journal, null, 2))
    .then(() => ok(journal))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return err("InternalServerError", message);
    });
};

export const addJournalEntry = (
  journal: Journal,
  entry: JournalEntry,
): Journal => {
  return {
    ...journal,
    entries: [...journal.entries, entry],
  };
};

export const removeLastJournalEntry = (journal: Journal): Journal => {
  return {
    ...journal,
    entries: journal.entries.slice(0, -1),
  };
};

export const getLastEntry = (journal: Journal): JournalEntry | null => {
  if (journal.entries.length === 0) {
    return null;
  }
  return journal.entries[journal.entries.length - 1] ?? null;
};

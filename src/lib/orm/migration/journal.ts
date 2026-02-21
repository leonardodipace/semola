import { err, mightThrow, mightThrowSync, ok } from "../../errors/index.js";

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

  const [readError, content] = await mightThrow(file.text());
  if (readError) {
    return err(
      "InternalServerError",
      readError instanceof Error ? readError.message : String(readError),
    );
  }

  const [parseError, journal] = mightThrowSync(() => JSON.parse(content ?? ""));
  if (parseError) {
    return err(
      "InternalServerError",
      parseError instanceof Error ? parseError.message : String(parseError),
    );
  }

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
};

export const writeJournal = async (filePath: string, journal: Journal) => {
  const [error] = await mightThrow(
    Bun.write(filePath, JSON.stringify(journal, null, 2)),
  );
  if (error) {
    return err(
      "InternalServerError",
      error instanceof Error ? error.message : String(error),
    );
  }
  return ok(journal);
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

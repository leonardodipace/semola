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

export const readJournal = async (filePath: string): Promise<Journal> => {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return createEmptyJournal();
  }

  const content = await file.text();
  const journal = JSON.parse(content);

  // Basic validation
  if (
    typeof journal !== "object" ||
    journal === null ||
    typeof journal.version !== "number" ||
    !Array.isArray(journal.entries)
  ) {
    throw new Error(`Invalid journal format in ${filePath}`);
  }

  return journal as Journal;
};

export const writeJournal = async (filePath: string, journal: Journal) => {
  const json = JSON.stringify(journal, null, 2);
  await Bun.write(filePath, json);
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

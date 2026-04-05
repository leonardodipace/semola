import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { mightThrowSync } from "../../errors/index.js";
import type { MigrationState } from "./types.js";

const defaultState: MigrationState = {
  applied: [],
};

export async function readMigrationState(statePath: string) {
  const exists = await Bun.file(statePath).exists();
  if (!exists) {
    return defaultState;
  }

  const content = await Bun.file(statePath).text();
  if (!content.trim()) {
    return defaultState;
  }

  const [parseErr, parsed] = mightThrowSync(() => JSON.parse(content));

  if (parseErr) {
    return defaultState;
  }

  if (!parsed?.applied) {
    return defaultState;
  }

  if (!Array.isArray(parsed.applied)) {
    return defaultState;
  }

  return parsed as MigrationState;
}

export async function writeMigrationState(
  statePath: string,
  state: MigrationState,
) {
  await mkdir(dirname(statePath), { recursive: true });
  await Bun.write(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export async function markAppliedMigration(
  statePath: string,
  migration: { id: string; directoryName: string },
) {
  const state = await readMigrationState(statePath);

  const existing = state.applied.find((item) => {
    if (item.directoryName) {
      return item.directoryName === migration.directoryName;
    }

    return item.id === migration.id;
  });

  if (existing) {
    return state;
  }

  const nextState: MigrationState = {
    applied: [
      ...state.applied,
      {
        id: migration.id,
        directoryName: migration.directoryName,
        appliedAt: new Date().toISOString(),
      },
    ],
  };

  await writeMigrationState(statePath, nextState);
  return nextState;
}

export async function unmarkAppliedMigration(
  statePath: string,
  migration: { id: string; directoryName: string },
) {
  const state = await readMigrationState(statePath);

  const nextState: MigrationState = {
    applied: state.applied.filter((item) => {
      if (item.directoryName) {
        return item.directoryName !== migration.directoryName;
      }

      return item.id !== migration.id;
    }),
  };

  await writeMigrationState(statePath, nextState);
  return nextState;
}

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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

  const parsed = JSON.parse(content) as MigrationState;
  if (!parsed.applied || !Array.isArray(parsed.applied)) {
    return defaultState;
  }

  return parsed;
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
  migrationId: string,
) {
  const state = await readMigrationState(statePath);
  const existing = state.applied.find((item) => item.id === migrationId);
  if (existing) {
    return state;
  }

  const nextState: MigrationState = {
    applied: [
      ...state.applied,
      {
        id: migrationId,
        appliedAt: new Date().toISOString(),
      },
    ],
  };

  await writeMigrationState(statePath, nextState);
  return nextState;
}

export async function unmarkAppliedMigration(
  statePath: string,
  migrationId: string,
) {
  const state = await readMigrationState(statePath);
  const nextState: MigrationState = {
    applied: state.applied.filter((item) => item.id !== migrationId),
  };
  await writeMigrationState(statePath, nextState);
  return nextState;
}

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markAppliedMigration,
  readMigrationState,
  unmarkAppliedMigration,
} from "./state-file.js";

describe("migration state file", () => {
  test("marks and unmarks applied migrations", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "semola-state-"));
    const statePath = join(tempDir, "state.json");

    try {
      await Bun.write(statePath, "");

      await markAppliedMigration(statePath, "20260228000000");

      let state = await readMigrationState(statePath);
      expect(state.applied).toHaveLength(1);
      expect(state.applied[0]?.id).toBe("20260228000000");

      await unmarkAppliedMigration(statePath, "20260228000000");

      state = await readMigrationState(statePath);
      expect(state.applied).toHaveLength(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

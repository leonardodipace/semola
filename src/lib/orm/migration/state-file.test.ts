import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  markAppliedMigration,
  readMigrationState,
  unmarkAppliedMigration,
} from "./state-file.js";

describe("migration state file", () => {
  test("marks and unmarks applied migrations", async () => {
    const cwd = process.cwd();
    const statePath = join(cwd, "tmp-state-file-test.json");

    await Bun.write(statePath, "");

    await markAppliedMigration(statePath, "20260228000000");
    let state = await readMigrationState(statePath);
    expect(state.applied).toHaveLength(1);
    expect(state.applied[0]?.id).toBe("20260228000000");

    await unmarkAppliedMigration(statePath, "20260228000000");
    state = await readMigrationState(statePath);
    expect(state.applied).toHaveLength(0);

    await Bun.file(statePath).delete();
  });
});

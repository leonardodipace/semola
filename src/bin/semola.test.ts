import { describe, expect, test } from "bun:test";
import { runSemolaCli } from "./semola.js";

function createIo() {
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    logs,
    errors,
    io: {
      cwd: process.cwd(),
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

describe("semola CLI", () => {
  test("returns 1 for invalid command", async () => {
    const { io, errors } = createIo();
    const code = await runSemolaCli(["orm"], io);
    expect(code).toBe(1);
    expect(errors[0]).toContain("Usage:");
  });

  test("returns 1 for missing create name", async () => {
    const { io, errors } = createIo();
    const code = await runSemolaCli(["orm", "migrations", "create"], io);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Missing migration name");
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the built module under real Node, not Bun's emulation of it.
const CHECK_SCRIPT = `
import { Cron, CronOS } from "./index.js";

const mode = process.argv.at(-1);

if (mode === "fire") {
  // Move the clock so the next minute boundary is 500ms away.
  const realNow = Date.now.bind(Date);
  const boundary = Math.ceil(realNow() / 60_000) * 60_000;
  const offset = boundary - 500 - realNow();
  Date.now = () => realNow() + offset;

  const osError = await new CronOS({
    name: "os",
    schedule: "@daily",
    path: "./job.ts",
  })
    .run()
    .catch((error) => error.name);

  const job = new Cron({
    name: "fire",
    schedule: "* * * * *",
    handler: () => {
      job.stop();
      console.log(JSON.stringify({ fired: true, osError, next: job.next() }));
    },
  });

  job.run();
}

if (mode === "unref") {
  const job = new Cron({ name: "unref", schedule: "@yearly", handler: () => {} });

  job.run();
  job.unref();
  console.log(JSON.stringify({ unref: true }));
}
`;

const node = Bun.which("node");

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "semola-cron-"));

  await Bun.build({
    entrypoints: [join(import.meta.dir, "index.ts")],
    outdir: dir,
    target: "node",
  });

  writeFileSync(join(dir, "check.mjs"), CHECK_SCRIPT);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!node)("on node", () => {
  const run = async (mode: string) => {
    const proc = Bun.spawn([node ?? "", "check.mjs", mode], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    return { stdout, stderr, code };
  };

  test("should fire an in-process job and reject CronOS", async () => {
    const { stdout, stderr, code } = await run("fire");

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const result = JSON.parse(stdout);

    expect(result.fired).toBe(true);
    expect(result.osError).toBe("UnsupportedRuntimeError");
    expect(typeof result.next).toBe("string");
  }, 20_000);

  test("should let the process exit after unref", async () => {
    const { stdout, code } = await run("unref");

    expect(code).toBe(0);
    expect(JSON.parse(stdout).unref).toBe(true);
  }, 20_000);
});

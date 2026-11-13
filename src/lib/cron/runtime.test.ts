import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the built module under real Node, not Bun's emulation of it.
const CHECK_SCRIPT = `
import { Cron } from "./index.js";

// Run the clock fast so minute boundaries pass within a second of real time.
const realNow = Date.now.bind(Date);
const start = realNow();
Date.now = () => start + (realNow() - start) * 200;

const errors = [];
process.on("unhandledRejection", (error) => errors.push(String(error)));

// An unref'd job must not keep the process alive once the first job stops,
// also when unref() comes before run() and survives a restart.
const idle = new Cron({ name: "idle", schedule: "@yearly", handler: () => {} });
idle.unref();
idle.run();
idle.stop();
idle.run();

let calls = 0;
const job = new Cron({
  name: "fire",
  schedule: "* * * * *",
  handler: () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    if (calls === 2) return Promise.reject();

    job.stop();
    console.log(JSON.stringify({ calls, errors }));
  },
});

job.run();
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

test.skipIf(!node)(
  "should fire, surface any handler rejection and let Node exit after unref",
  async () => {
    const proc = Bun.spawn([node ?? "", "check.mjs"], {
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

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      calls: 3,
      errors: ["Error: boom", "undefined"],
    });
  },
  20_000,
);

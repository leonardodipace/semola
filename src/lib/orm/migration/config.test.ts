import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, loadConfig } from "./config.js";

describe("defineConfig", () => {
  test("returns the same config object", () => {
    const config = defineConfig({
      orm: {
        schema: "./src/db/index.ts",
      },
    });

    expect(config.orm.schema).toBe("./src/db/index.ts");
  });
});

describe("loadConfig", () => {
  test("loads semola config and applies defaults", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-config-"));
    await mkdir(join(cwd, "src", "db"), { recursive: true });

    await Bun.write(
      join(cwd, "semola.config.ts"),
      [
        "export default {",
        "  orm: {",
        "    schema: './src/db/index.ts',",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const [error, result] = await loadConfig(cwd);

    expect(error).toBeNull();
    expect(result?.orm.schema).toBe(join(cwd, "src", "db", "index.ts"));
    expect(result?.orm.migrations.dir).toBe(join(cwd, "migrations"));
    expect(result?.orm.migrations.stateFile).toBe(
      join(cwd, ".semola-migrations.json"),
    );
    expect(result?.orm.migrations.transactional).toBe(true);
  });

  test("returns error when config is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-config-missing-"));

    const [error, result] = await loadConfig(cwd);

    expect(result).toBeNull();
    expect(error?.message).toContain("Could not find semola.config.ts");
  });
});

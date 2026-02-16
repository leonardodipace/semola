import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchemaTables, loadSemolaConfig } from "./config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "semola-cli-config-"));
  tempDirs.push(dir);
  return dir;
};

describe("loadSemolaConfig", () => {
  test("returns error when config file is missing", async () => {
    const dir = await createTempDir();
    const [error, config] = await loadSemolaConfig(dir);

    expect(config).toBeNull();
    expect(error?.message).toContain("Missing semola config file");
  });

  test("loads valid config and resolves schema path", async () => {
    const dir = await createTempDir();

    await writeFile(
      join(dir, "semola.config.ts"),
      `export default {
  orm: {
    dialect: "sqlite",
    url: ":memory:",
  },
  schema: {
    path: "./src/db/schema.ts",
  },
};
`,
      "utf8",
    );

    const [error, config] = await loadSemolaConfig(dir);

    expect(error).toBeNull();
    expect(config?.orm.dialect).toBe("sqlite");
    expect(config?.schema.path).toBe(join(dir, "src/db/schema.ts"));
  });

  test("returns validation error for invalid config shape", async () => {
    const dir = await createTempDir();

    await writeFile(
      join(dir, "semola.config.ts"),
      `export default {
  orm: {
    dialect: "sqlite",
  },
};
`,
      "utf8",
    );

    const [error, config] = await loadSemolaConfig(dir);

    expect(config).toBeNull();
    expect(error?.message).toContain("missing schema section");
  });
});

describe("loadSchemaTables", () => {
  test("loads named export tables object", async () => {
    const dir = await createTempDir();
    const schemaPath = join(dir, "schema.ts");

    await writeFile(
      schemaPath,
      `import { Table, number, string } from "${join(process.cwd(), "src/lib/orm/index.ts")}";

export const tables = {
  users: new Table("users", {
    id: number("id").primaryKey(),
    name: string("name").notNull(),
  }),
};
`,
      "utf8",
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users");
  });

  test("loads default export array of tables", async () => {
    const dir = await createTempDir();
    const schemaPath = join(dir, "schema.ts");

    await writeFile(
      schemaPath,
      `import { Table, number } from "${join(process.cwd(), "src/lib/orm/index.ts")}";

export default [
  new Table("users", {
    id: number("id").primaryKey(),
  }),
];
`,
      "utf8",
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users");
  });

  test("returns error when schema export is missing", async () => {
    const dir = await createTempDir();
    const schemaPath = join(dir, "schema.ts");

    await writeFile(schemaPath, "export const nope = 1;", "utf8");

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(tables).toBeNull();
    expect(error?.message).toContain("does not export tables");
  });

  test("returns error when schema contains non-table values", async () => {
    const dir = await createTempDir();
    const schemaPath = join(dir, "schema.ts");

    await writeFile(
      schemaPath,
      `export const tables = {
  users: { not: "a table" },
};
`,
      "utf8",
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(tables).toBeNull();
    expect(error?.message).toContain("is not a Table instance");
  });

  test("distinguishes between undefined named export and missing export (falsy value handling)", async () => {
    const dir = await createTempDir();
    const schemaPath = join(dir, "schema.ts");

    // Tests the fix for: using nullish coalescing would incorrectly fall through
    // when named export is explicitly undefined. We use 'in' operator instead.
    await writeFile(
      schemaPath,
      `import { Table, number } from "${join(process.cwd(), "src/lib/orm/index.ts")}";

const defaultTables = {
  users: new Table("users", {
    id: number("id").primaryKey(),
  }),
};

// Explicitly set tables to undefined (edge case)
export const tables = undefined;

// Default export as fallback
export default defaultTables;
`,
      "utf8",
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    // Should report error since tables is explicitly undefined, not missing
    expect(tables).toBeNull();
    expect(error?.message).toContain("does not export tables");
  });

  test("falls back to default export when named export doesn't exist", async () => {
    const dir = await createTempDir();
    const schemaPath = join(dir, "schema.ts");

    await writeFile(
      schemaPath,
      `import { Table, number } from "${join(process.cwd(), "src/lib/orm/index.ts")}";

export default {
  users: new Table("users", {
    id: number("id").primaryKey(),
  }),
};
`,
      "utf8",
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users");
  });
});

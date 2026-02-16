import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadSchemaTables, loadSemolaConfig } from "./config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

const createTempDir = async () => {
  const dir = await mkdtemp(`${tmpdir()}/semola-cli-config-`);
  tempDirs.push(dir);
  return dir;
};

describe("loadSemolaConfig", () => {
  test("throws error when config file is missing", async () => {
    const dir = await createTempDir();

    await expect(loadSemolaConfig(dir)).rejects.toThrow(
      "Missing semola config file",
    );
  });

  test("loads valid config and resolves schema path", async () => {
    const dir = await createTempDir();

    await Bun.write(
      `${dir}/semola.config.ts`,
      `export default {
  orm: {
    dialect: "sqlite",
    url: ":memory:",
    schema: {
      path: "./src/db/schema.ts",
    },
  },
};
`,
    );

    const config = await loadSemolaConfig(dir);

    expect(config.orm.dialect).toBe("sqlite");
    expect(config.orm.schema.path).toBe(`${dir}/src/db/schema.ts`);
  });

  test("throws validation error for invalid config shape", async () => {
    const dir = await createTempDir();

    await Bun.write(
      `${dir}/semola.config.ts`,
      `export default {
  orm: {
    dialect: "sqlite",
    url: ":memory:",
  },
};
`,
    );

    await expect(loadSemolaConfig(dir)).rejects.toThrow(
      "missing orm.schema section",
    );
  });
});

describe("loadSchemaTables", () => {
  test("loads named export tables object", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Table, number, string } from "${process.cwd()}/src/lib/orm/index.ts";

export const tables = {
  users: new Table("users", {
    id: number("id").primaryKey(),
    name: string("name").notNull(),
  }),
};
`,
    );

    const tables = await loadSchemaTables(schemaPath);

    expect(tables.users?.sqlName).toBe("users");
  });

  test("loads default export array of tables", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Table, number } from "${process.cwd()}/src/lib/orm/index.ts";

export default [
  new Table("users", {
    id: number("id").primaryKey(),
  }),
];
`,
    );

    const tables = await loadSchemaTables(schemaPath);

    expect(tables.users?.sqlName).toBe("users");
  });

  test("throws error when schema export is missing", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(schemaPath, "export const nope = 1;");

    await expect(loadSchemaTables(schemaPath)).rejects.toThrow(
      "does not export tables",
    );
  });

  test("throws error when schema contains non-table values", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `export const tables = {
  users: { not: "a table" },
};
`,
    );

    await expect(loadSchemaTables(schemaPath)).rejects.toThrow(
      "is not a Table instance",
    );
  });

  test("distinguishes between undefined named export and missing export (falsy value handling)", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    // Tests the fix for: using nullish coalescing would incorrectly fall through
    // when named export is explicitly undefined. We use 'in' operator instead.
    await Bun.write(
      schemaPath,
      `import { Table, number } from "${process.cwd()}/src/lib/orm/index.ts";

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
    );

    // Should throw error since tables is explicitly undefined, not missing
    await expect(loadSchemaTables(schemaPath)).rejects.toThrow(
      "does not export tables",
    );
  });

  test("falls back to default export when named export doesn't exist", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Table, number } from "${process.cwd()}/src/lib/orm/index.ts";

export default {
  users: new Table("users", {
    id: number("id").primaryKey(),
  }),
};
`,
    );

    const tables = await loadSchemaTables(schemaPath);

    expect(tables.users?.sqlName).toBe("users");
  });
});

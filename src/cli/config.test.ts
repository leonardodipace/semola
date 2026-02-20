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
  test("returns error when config file is missing", async () => {
    const dir = await createTempDir();

    const [error] = await loadSemolaConfig(dir);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("Missing semola config file");
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

    const [error, config] = await loadSemolaConfig(dir);

    expect(error).toBeNull();
    expect(config?.orm.dialect).toBe("sqlite");
    expect(config?.orm.schema.path).toBe(`${dir}/src/db/schema.ts`);
  });

  test("returns validation error for invalid config shape", async () => {
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

    const [error] = await loadSemolaConfig(dir);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("missing orm.schema section");
  });

  test("returns explicit error for unsupported orm dialect", async () => {
    const dir = await createTempDir();

    await Bun.write(
      `${dir}/semola.config.ts`,
      `export default {
  orm: {
    dialect: "mssql",
    url: ":memory:",
    schema: {
      path: "./src/db/schema.ts",
    },
  },
};
`,
    );

    const [error] = await loadSemolaConfig(dir);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("unsupported orm.dialect value");
    expect(error?.message).toContain("mssql");
  });

  test("accepts all supported orm dialect values", async () => {
    const dialects = ["sqlite", "mysql", "postgres"] as const;

    for (const dialect of dialects) {
      const dir = await createTempDir();

      await Bun.write(
        `${dir}/semola.config.ts`,
        `export default {
  orm: {
    dialect: "${dialect}",
    url: ":memory:",
    schema: {
      path: "./src/db/schema.ts",
    },
  },
};
`,
      );

      const [error, config] = await loadSemolaConfig(dir);
      expect(error).toBeNull();
      expect(config?.orm.dialect).toBe(dialect);
    }
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

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users");
  });

  test("uses object keys as table names even when sqlName differs", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Table, number } from "${process.cwd()}/src/lib/orm/index.ts";

export const tables = {
  usersById: new Table("users", {
    id: number("id").primaryKey(),
  }),
};
`,
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.usersById).toBeDefined();
    expect(tables?.usersById?.sqlName).toBe("users");
    expect(tables?.users).toBeUndefined();
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

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users");
  });

  test("returns validation error when array export has duplicate sqlName", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Table, number } from "${process.cwd()}/src/lib/orm/index.ts";

export default [
  new Table("users", {
    id: number("id").primaryKey(),
  }),
  new Table("users", {
    id: number("id").primaryKey(),
  }),
];
`,
    );

    const [error] = await loadSchemaTables(schemaPath);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("duplicate table sqlName");
    expect(error?.message).toContain("users");
  });

  test("returns error when schema export is missing", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(schemaPath, "export const nope = 1;");

    const [error] = await loadSchemaTables(schemaPath);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("does not export tables");
  });

  test("returns error when schema contains non-table values", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `export const tables = {
  users: { not: "a table" },
};
`,
    );

    const [error] = await loadSchemaTables(schemaPath);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("is not a Table instance");
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
    const [error] = await loadSchemaTables(schemaPath);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("does not export tables");
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

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users");
  });

  test("prefers named export over default when both exist", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Table, number } from "${process.cwd()}/src/lib/orm/index.ts";

export const tables = {
  users: new Table("users_named", {
    id: number("id").primaryKey(),
  }),
};

export default {
  users: new Table("users_default", {
    id: number("id").primaryKey(),
  }),
};
`,
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users_named");
  });
});

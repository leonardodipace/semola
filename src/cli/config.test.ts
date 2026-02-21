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
  test("loads tables from default export Orm instance", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Orm, Table, number, string } from "${process.cwd()}/src/lib/orm/index.ts";

const usersTable = new Table("users", {
  id: number().primaryKey(),
  name: string().notNull(),
  email: string().notNull().unique(),
});

export default new Orm({
  url: "sqlite://:memory:",
  tables: { users: usersTable },
});
`,
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.users?.sqlName).toBe("users");
  });

  test("uses the object key as the table name", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(
      schemaPath,
      `import { Orm, Table, number } from "${process.cwd()}/src/lib/orm/index.ts";

export default new Orm({
  url: "sqlite://:memory:",
  tables: {
    usersById: new Table("users", { id: number().primaryKey() }),
  },
});
`,
    );

    const [error, tables] = await loadSchemaTables(schemaPath);

    expect(error).toBeNull();
    expect(tables?.usersById?.sqlName).toBe("users");
    expect(tables?.users).toBeUndefined();
  });

  test("returns error when schema has no default export", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(schemaPath, "export const nope = 1;");

    const [error] = await loadSchemaTables(schemaPath);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("Orm instance");
  });

  test("returns error when default export is not an Orm instance", async () => {
    const dir = await createTempDir();
    const schemaPath = `${dir}/schema.ts`;

    await Bun.write(schemaPath, "export default { not: 'an orm' };");

    const [error] = await loadSchemaTables(schemaPath);

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("Orm instance");
  });
});

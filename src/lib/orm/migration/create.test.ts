import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigration } from "./create.js";

describe("createMigration", () => {
  test("creates migration folder with up.sql and down.sql", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-mig-"));

    try {
      await mkdir(join(cwd, "src", "db"), { recursive: true });

      const configContent = [
        "export default {",
        "  orm: {",
        "    schema: './src/db/schema.ts',",
        "    migrations: { dir: './migrations' }",
        "  }",
        "};",
        "",
      ].join("\n");

      const schemaContent = [
        "const idColumn = {",
        "  kind: 'uuid',",
        "  meta: {",
        "    sqlName: 'id',",
        "    isPrimaryKey: true,",
        "    isNotNull: true,",
        "    isUnique: false,",
        "    hasDefault: false,",
        "    defaultFn: null,",
        "    references: null,",
        "    onDeleteAction: null,",
        "  },",
        "};",
        "",
        "export default {",
        "  options: { url: 'postgres://localhost/db' },",
        "  dialect: 'postgres',",
        "  tables: {",
        "    users: {",
        "      tableName: 'users',",
        "      columns: { id: idColumn },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n");

      await Bun.write(join(cwd, "semola.config.ts"), configContent);
      await Bun.write(join(cwd, "src", "db", "schema.ts"), schemaContent);

      const [error, result] = await createMigration({ name: "init", cwd });
      expect(error).toBeNull();
      expect(result?.created).toBe(true);

      if (!result?.created) {
        return;
      }

      const upExists = await Bun.file(result.upPath).exists();
      const downExists = await Bun.file(result.downPath).exists();
      expect(upExists).toBe(true);
      expect(downExists).toBe(true);

      const upSql = await Bun.file(result.upPath).text();
      expect(upSql).toContain('CREATE TABLE "users"');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("creates migration when schema exports createOrm client", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-mig-client-"));

    try {
      await mkdir(join(cwd, "src", "db"), { recursive: true });

      const configContent = [
        "export default {",
        "  orm: {",
        "    schema: './src/db/schema.ts',",
        "    migrations: { dir: './migrations' }",
        "  }",
        "};",
        "",
      ].join("\n");

      const ormModulePathTs = join(import.meta.dir, "..", "index.ts");
      const ormModulePathJs = join(import.meta.dir, "..", "index.js");

      let ormModulePath = ormModulePathJs;

      if (await Bun.file(ormModulePathTs).exists()) {
        ormModulePath = ormModulePathTs;
      }

      const schemaContent = [
        `import { createOrm, createTable, uuid } from '${ormModulePath}';`,
        "",
        "const users = createTable('users', {",
        "  id: uuid('id').primaryKey(),",
        "});",
        "",
        "export default createOrm({",
        "  url: 'sqlite::memory:',",
        "  tables: { users },",
        "});",
        "",
      ].join("\n");

      await Bun.write(join(cwd, "semola.config.ts"), configContent);
      await Bun.write(join(cwd, "src", "db", "schema.ts"), schemaContent);

      const [error, result] = await createMigration({ name: "add_users", cwd });
      expect(error).toBeNull();
      expect(result?.created).toBe(true);

      if (!result?.created) {
        return;
      }

      const upSql = await Bun.file(result.upPath).text();
      expect(upSql).toContain('CREATE TABLE "users"');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

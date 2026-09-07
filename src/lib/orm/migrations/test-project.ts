import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";

export const createMigrationProject = async (
  dirs: string[],
  dbUrl: string,
  adapter: "sqlite" | "postgres" = "sqlite",
) => {
  const root = await mkdtemp(join(tmpdir(), "semola-mig-"));
  dirs.push(root);

  if (adapter === "sqlite") {
    dirs.push(dirname(dbUrl));
  }

  const users = defineTable({
    sqlName: "users",
    columns: {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
    },
  });

  const schemaPath = join(root, "db.ts");
  const configPath = join(root, "semola.config.ts");
  const migrationsDir = join(root, "migrations");

  await writeFile(
    schemaPath,
    `
import { createOrm, defineTable, string, uuid } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};

const users = defineTable({
  sqlName: "users",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    name: string("name").notNull(),
    email: string("email").notNull().unique(),
  },
});

export const db = createOrm({
  adapter: ${JSON.stringify(adapter)},
  url: ${JSON.stringify(dbUrl)},
  tables: { users },
});
`,
  );

  await writeFile(
    configPath,
    `
import { defineConfig } from ${JSON.stringify(join(import.meta.dir, "../../config.ts"))};

export default defineConfig({
  orm: {
    schema: "./db.ts",
    migrationsDir: "./migrations",
  },
});
`,
  );

  await mkdir(migrationsDir, { recursive: true });

  return {
    root,
    users,
    migrationsDir,
    dbPath: dbUrl,
  };
};

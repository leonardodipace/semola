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

      const result = await createMigration({ name: "init", cwd });
      expect(result.created).toBe(true);

      if (!result.created) {
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

      const result = await createMigration({ name: "add_users", cwd });
      expect(result.created).toBe(true);

      if (!result.created) {
        return;
      }

      const upSql = await Bun.file(result.upPath).text();
      expect(upSql).toContain('CREATE TABLE "users"');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("emits inline REFERENCES for sqlite foreign keys", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-mig-fk-"));

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
        `import { createOrm, createTable, string, uuid } from '${ormModulePath}';`,
        "",
        "const users = createTable('users', {",
        "  id: uuid('id').primaryKey(),",
        "  email: string('email').notNull(),",
        "});",
        "",
        "const tasks = createTable('tasks', {",
        "  id: uuid('id').primaryKey(),",
        "  assigneeId: uuid('assignee_id').references(() => users.columns.id).onDelete('CASCADE'),",
        "});",
        "",
        "export default createOrm({",
        "  url: 'sqlite::memory:',",
        "  tables: { users, tasks },",
        "});",
        "",
      ].join("\n");

      await Bun.write(join(cwd, "semola.config.ts"), configContent);
      await Bun.write(join(cwd, "src", "db", "schema.ts"), schemaContent);

      const result = await createMigration({ name: "add_tasks", cwd });
      expect(result.created).toBe(true);

      if (!result.created) {
        return;
      }

      const upSql = await Bun.file(result.upPath).text();
      expect(upSql).toContain(
        '"assignee_id" TEXT REFERENCES "users" ("id") ON DELETE CASCADE',
      );
      expect(upSql).not.toContain("FOREIGN KEY");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("generates sqlite rebuild SQL for altered columns", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-mig-rebuild-"));

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

      const schemaV2 = [
        `import { createOrm, createTable, string, uuid } from '${ormModulePath}';`,
        "",
        "const examTable = createTable('exam', {",
        "  id: uuid('id').primaryKey(),",
        "  name: string('name').notNull(),",
        "});",
        "",
        "const studentTable = createTable('student', {",
        "  id: uuid('id').primaryKey(),",
        "  examId: uuid('exam_id').references(() => examTable.columns.id).notNull(),",
        "});",
        "",
        "export default createOrm({",
        "  url: 'sqlite::memory:',",
        "  tables: { exam: examTable, student: studentTable },",
        "});",
        "",
      ].join("\n");

      const previousSnapshot = {
        dialect: "sqlite",
        tables: {
          exam: {
            key: "exam",
            tableName: "exam",
            columns: {
              id: {
                key: "id",
                sqlName: "id",
                kind: "uuid",
                isPrimaryKey: true,
                isNotNull: true,
                isUnique: false,
                hasDefault: false,
                referencesTable: null,
                referencesColumn: null,
                onDeleteAction: null,
              },
              name: {
                key: "name",
                sqlName: "name",
                kind: "string",
                isPrimaryKey: false,
                isNotNull: false,
                isUnique: false,
                hasDefault: false,
                referencesTable: null,
                referencesColumn: null,
                onDeleteAction: null,
              },
            },
          },
          student: {
            key: "student",
            tableName: "student",
            columns: {
              id: {
                key: "id",
                sqlName: "id",
                kind: "uuid",
                isPrimaryKey: true,
                isNotNull: true,
                isUnique: false,
                hasDefault: false,
                referencesTable: null,
                referencesColumn: null,
                onDeleteAction: null,
              },
              examId: {
                key: "examId",
                sqlName: "exam_id",
                kind: "uuid",
                isPrimaryKey: false,
                isNotNull: false,
                isUnique: false,
                hasDefault: false,
                referencesTable: "exam",
                referencesColumn: "id",
                onDeleteAction: null,
              },
            },
          },
        },
      };

      await Bun.write(join(cwd, "semola.config.ts"), configContent);
      await Bun.write(join(cwd, "src", "db", "schema.ts"), schemaV2);

      const previousMigrationDir = join(
        cwd,
        "migrations",
        "20260101000000000_init",
      );
      await mkdir(previousMigrationDir, { recursive: true });
      await Bun.write(join(previousMigrationDir, "up.sql"), "-- init\n");
      await Bun.write(join(previousMigrationDir, "down.sql"), "-- init\n");
      await Bun.write(
        join(previousMigrationDir, "snapshot.json"),
        `${JSON.stringify(previousSnapshot, null, 2)}\n`,
      );

      const second = await createMigration({ name: "enforce_not_null", cwd });
      expect(second.created).toBe(true);

      if (!second.created) {
        return;
      }

      const upSql = await Bun.file(second.upPath).text();
      const downSql = await Bun.file(second.downPath).text();

      expect(upSql).toContain("PRAGMA foreign_keys = OFF");
      expect(upSql).toContain("BEGIN");
      expect(upSql).toContain(
        'ALTER TABLE "exam" RENAME TO "__semola_tmp_exam"',
      );
      expect(upSql).toContain(
        'ALTER TABLE "student" RENAME TO "__semola_tmp_student"',
      );
      expect(upSql).toContain(
        'INSERT INTO "exam" ("id", "name") SELECT "id", "name" FROM "__semola_tmp_exam"',
      );
      expect(upSql).toContain(
        'INSERT INTO "student" ("id", "exam_id") SELECT "id", "exam_id" FROM "__semola_tmp_student"',
      );
      expect(upSql).toContain("COMMIT");
      expect(upSql).toContain("PRAGMA foreign_keys = ON");

      expect(upSql).not.toContain(
        'ALTER TABLE "student" DROP COLUMN "exam_id"',
      );
      expect(upSql).not.toContain(
        'ALTER TABLE "student" ADD COLUMN "exam_id" TEXT NOT NULL REFERENCES "exam" ("id")',
      );

      expect(downSql).toContain("PRAGMA foreign_keys = OFF");
      expect(downSql).toContain(
        'ALTER TABLE "exam" RENAME TO "__semola_tmp_exam"',
      );
      expect(downSql).toContain(
        'ALTER TABLE "student" RENAME TO "__semola_tmp_student"',
      );
      expect(downSql).toContain('"name" TEXT');
      expect(downSql).toContain('"exam_id" TEXT REFERENCES "exam" ("id")');
      expect(downSql).toContain("PRAGMA foreign_keys = ON");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("generates sqlite rebuild SQL for renamed foreign key columns", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-mig-rename-"));

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

      const schemaV2 = [
        `import { createOrm, createTable, string, uuid } from '${ormModulePath}';`,
        "",
        "const examTable = createTable('exam', {",
        "  id: uuid('id').primaryKey(),",
        "  name: string('name').notNull(),",
        "});",
        "",
        "const studentTable = createTable('student', {",
        "  id: uuid('id').primaryKey(),",
        "  name: string('name').notNull(),",
        "  examId: uuid('examID').references(() => examTable.columns.id).notNull(),",
        "});",
        "",
        "export default createOrm({",
        "  url: 'sqlite::memory:',",
        "  tables: { exam: examTable, student: studentTable },",
        "});",
        "",
      ].join("\n");

      const previousSnapshot = {
        dialect: "sqlite",
        tables: {
          exam: {
            key: "exam",
            tableName: "exam",
            columns: {
              id: {
                key: "id",
                sqlName: "id",
                kind: "uuid",
                isPrimaryKey: true,
                isNotNull: true,
                isUnique: false,
                hasDefault: false,
                referencesTable: null,
                referencesColumn: null,
                onDeleteAction: null,
              },
              name: {
                key: "name",
                sqlName: "name",
                kind: "string",
                isPrimaryKey: false,
                isNotNull: true,
                isUnique: false,
                hasDefault: false,
                referencesTable: null,
                referencesColumn: null,
                onDeleteAction: null,
              },
            },
          },
          student: {
            key: "student",
            tableName: "student",
            columns: {
              id: {
                key: "id",
                sqlName: "id",
                kind: "uuid",
                isPrimaryKey: true,
                isNotNull: true,
                isUnique: false,
                hasDefault: false,
                referencesTable: null,
                referencesColumn: null,
                onDeleteAction: null,
              },
              name: {
                key: "name",
                sqlName: "name",
                kind: "string",
                isPrimaryKey: false,
                isNotNull: true,
                isUnique: false,
                hasDefault: false,
                referencesTable: null,
                referencesColumn: null,
                onDeleteAction: null,
              },
              examId: {
                key: "examId",
                sqlName: "exam_id",
                kind: "uuid",
                isPrimaryKey: false,
                isNotNull: true,
                isUnique: false,
                hasDefault: false,
                referencesTable: "exam",
                referencesColumn: "id",
                onDeleteAction: null,
              },
            },
          },
        },
      };

      await Bun.write(join(cwd, "semola.config.ts"), configContent);
      await Bun.write(join(cwd, "src", "db", "schema.ts"), schemaV2);

      const previousMigrationDir = join(
        cwd,
        "migrations",
        "20260101000000000_init",
      );
      await mkdir(previousMigrationDir, { recursive: true });
      await Bun.write(join(previousMigrationDir, "up.sql"), "-- init\n");
      await Bun.write(join(previousMigrationDir, "down.sql"), "-- init\n");
      await Bun.write(
        join(previousMigrationDir, "snapshot.json"),
        `${JSON.stringify(previousSnapshot, null, 2)}\n`,
      );

      const result = await createMigration({ name: "rename_exam_fk", cwd });
      expect(result.created).toBe(true);

      if (!result.created) {
        return;
      }

      const upSql = await Bun.file(result.upPath).text();

      expect(upSql).toContain(
        'INSERT INTO "student" ("id", "name", "examID") SELECT "id", "name", "exam_id" FROM "__semola_tmp_student"',
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

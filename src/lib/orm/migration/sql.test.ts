import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { splitStatements } from "./files.js";
import { buildDownSql, buildUpSql } from "./sql.js";
import type { MigrationOperation } from "./types.js";

const operations: MigrationOperation[] = [
  {
    kind: "create-table",
    table: {
      key: "users",
      tableName: "users",
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
      },
    },
  },
];

describe("buildUpSql/buildDownSql", () => {
  test("emits postgres create/drop statements", () => {
    const up = buildUpSql("postgres", operations);
    const down = buildDownSql("postgres", operations);

    expect(up).toContain('CREATE TABLE "users"');
    expect(up).toContain("DEFAULT gen_random_uuid()");
    expect(down).toContain('DROP TABLE "users"');
  });

  test("emits mysql quoting", () => {
    const up = buildUpSql("mysql", operations);
    expect(up).toContain("CREATE TABLE `users`");
  });

  test("wraps sqlite uuid default expression in parentheses", () => {
    const up = buildUpSql("sqlite", operations);

    expect(up).toContain("DEFAULT (lower(hex(randomblob(16))))");
  });

  test("maps jsonb by dialect", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "create-table",
        table: {
          key: "events",
          tableName: "events",
          columns: {
            payload: {
              key: "payload",
              sqlName: "payload",
              kind: "jsonb",
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
      },
    ];

    expect(buildUpSql("postgres", ops)).toContain('"payload" JSONB');
    expect(buildUpSql("mysql", ops)).toContain("`payload` JSON");
    expect(buildUpSql("sqlite", ops)).toContain('"payload" TEXT');
  });

  test("emits literal DEFAULT for added json column", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "meta",
          sqlName: "meta",
          kind: "json",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: true,
          defaultKind: "value",
          defaultValue: { level: 0 },
          referencesTable: null,
          referencesColumn: null,
          onDeleteAction: null,
        },
      },
    ];

    const up = buildUpSql("postgres", ops);
    expect(up).toContain(
      `ALTER TABLE "users" ADD COLUMN "meta" JSON NOT NULL DEFAULT '{"level":0}'`,
    );
  });

  test("emits foreign key clause in create table statements", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "create-table",
        table: {
          key: "tasks",
          tableName: "tasks",
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
            assigneeId: {
              key: "assigneeId",
              sqlName: "assignee_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "users",
              referencesColumn: "id",
              onDeleteAction: "CASCADE",
            },
          },
        },
      },
    ];

    const postgresSql = buildUpSql("postgres", ops);
    const mysqlSql = buildUpSql("mysql", ops);
    const sqliteSql = buildUpSql("sqlite", ops);

    expect(postgresSql).toContain(
      'FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE CASCADE',
    );
    expect(mysqlSql).toContain(
      "FOREIGN KEY (`assignee_id`) REFERENCES `users` (`id`) ON DELETE CASCADE",
    );
    expect(sqliteSql).toContain(
      '"assignee_id" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE',
    );
    expect(sqliteSql).not.toContain('FOREIGN KEY ("assignee_id")');

    const taskColumnLine =
      '"assignee_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE';
    expect(postgresSql).not.toContain(taskColumnLine);
  });

  test("emits multiple FOREIGN KEY clauses for one table", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "create-table",
        table: {
          key: "tasks",
          tableName: "tasks",
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
            assigneeId: {
              key: "assigneeId",
              sqlName: "assignee_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "users",
              referencesColumn: "id",
              onDeleteAction: "CASCADE",
            },
            projectId: {
              key: "projectId",
              sqlName: "project_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "projects",
              referencesColumn: "id",
              onDeleteAction: "RESTRICT",
            },
          },
        },
      },
    ];

    const postgresSql = buildUpSql("postgres", ops);

    expect(postgresSql).toContain(
      'FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE CASCADE',
    );
    expect(postgresSql).toContain(
      'FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT',
    );
  });

  test("emits foreign key clause for add-column statements", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "tasks",
        column: {
          key: "assigneeId",
          sqlName: "assignee_id",
          kind: "uuid",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: false,
          referencesTable: "users",
          referencesColumn: "id",
          onDeleteAction: "CASCADE",
        },
      },
    ];

    const postgresSql = buildUpSql("postgres", ops);

    expect(postgresSql).toContain(
      'ALTER TABLE "tasks" ADD COLUMN "assignee_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE',
    );
  });

  test("omits ON DELETE when relation action is null", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "tasks",
        column: {
          key: "assigneeId",
          sqlName: "assignee_id",
          kind: "uuid",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: false,
          referencesTable: "users",
          referencesColumn: "id",
          onDeleteAction: null,
        },
      },
    ];

    const up = buildUpSql("postgres", ops);

    expect(up).toContain('REFERENCES "users" ("id")');
    expect(up).not.toContain("ON DELETE");
  });

  test("serializes boolean defaults by dialect", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "isActive",
          sqlName: "is_active",
          kind: "boolean",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: true,
          defaultKind: "value",
          defaultValue: true,
          referencesTable: null,
          referencesColumn: null,
          onDeleteAction: null,
        },
      },
    ];

    expect(buildUpSql("postgres", ops)).toContain("DEFAULT TRUE");
    expect(buildUpSql("mysql", ops)).toContain("DEFAULT TRUE");
    expect(buildUpSql("sqlite", ops)).toContain("DEFAULT 1");
  });

  test("escapes string defaults", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "name",
          sqlName: "name",
          kind: "string",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: true,
          defaultKind: "value",
          defaultValue: "O'Hara",
          referencesTable: null,
          referencesColumn: null,
          onDeleteAction: null,
        },
      },
    ];

    const up = buildUpSql("postgres", ops);

    expect(up).toContain("DEFAULT 'O''Hara'");
  });

  test("serializes date defaults as ISO strings", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "createdAt",
          sqlName: "created_at",
          kind: "date",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: true,
          defaultKind: "value",
          defaultValue: new Date("2024-01-01T00:00:00.000Z"),
          referencesTable: null,
          referencesColumn: null,
          onDeleteAction: null,
        },
      },
    ];

    const up = buildUpSql("postgres", ops);

    expect(up).toContain("DEFAULT '2024-01-01T00:00:00.000Z'");
  });

  test("does not emit literal DEFAULT for function defaults", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "updatedAt",
          sqlName: "updated_at",
          kind: "date",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: true,
          defaultKind: "fn",
          referencesTable: null,
          referencesColumn: null,
          onDeleteAction: null,
        },
      },
    ];

    const up = buildUpSql("postgres", ops);

    expect(up).not.toContain(" DEFAULT ");
  });

  test("joins multiple statements with semicolons and trailing newline", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
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
      {
        kind: "drop-column",
        tableName: "users",
        column: {
          key: "legacy",
          sqlName: "legacy",
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
    ];

    const up = buildUpSql("postgres", ops);

    expect(up).toContain('ALTER TABLE "users" ADD COLUMN "name" TEXT');
    expect(up).toContain('ALTER TABLE "users" DROP COLUMN "legacy"');
    expect(up).toEndWith(";\n");
  });

  test("returns empty string for empty operations", () => {
    const up = buildUpSql("postgres", []);
    const down = buildDownSql("postgres", []);

    expect(up).toBe("");
    expect(down).toBe("");
  });

  test("buildDownSql reverses operation order", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "first",
          sqlName: "first",
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
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "second",
          sqlName: "second",
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
    ];

    const down = buildDownSql("postgres", ops);

    const secondIndex = down.indexOf('DROP COLUMN "second"');
    const firstIndex = down.indexOf('DROP COLUMN "first"');
    expect(secondIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeLessThan(firstIndex);
  });

  test("buildDownSql recreates table with FOREIGN KEY constraints", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "drop-table",
        table: {
          key: "tasks",
          tableName: "tasks",
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
            assigneeId: {
              key: "assigneeId",
              sqlName: "assignee_id",
              kind: "uuid",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: "users",
              referencesColumn: "id",
              onDeleteAction: "CASCADE",
            },
          },
        },
      },
    ];

    const down = buildDownSql("postgres", ops);

    expect(down).toContain('CREATE TABLE "tasks"');
    expect(down).toContain(
      'FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE CASCADE',
    );
  });

  test("sqlite rebuild migration preserves data for altered columns", async () => {
    const studentBefore = {
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
    } as const;

    const studentAfter = {
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
          isNotNull: true,
          isUnique: false,
          hasDefault: false,
          referencesTable: "exam",
          referencesColumn: "id",
          onDeleteAction: null,
        },
      },
    } as const;

    const examBefore = {
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
    } as const;

    const examAfter = {
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
    } as const;

    const ops: MigrationOperation[] = [
      {
        kind: "rebuild-table",
        fromTable: examBefore,
        toTable: examAfter,
      },
      {
        kind: "rebuild-table",
        fromTable: studentBefore,
        toTable: studentAfter,
      },
    ];

    const sqlText = buildUpSql("sqlite", ops);

    expect(sqlText).toContain("PRAGMA foreign_keys = OFF");
    expect(sqlText).toContain("BEGIN");
    expect(sqlText).toContain(
      'ALTER TABLE "exam" RENAME TO "__semola_tmp_exam"',
    );
    expect(sqlText).toContain(
      'ALTER TABLE "student" RENAME TO "__semola_tmp_student"',
    );
    expect(sqlText).toContain("COMMIT");
    expect(sqlText).toContain("PRAGMA foreign_keys = ON");

    const db = new SQL("sqlite::memory:");

    await db`PRAGMA foreign_keys = ON`;
    await db`CREATE TABLE exam (id TEXT PRIMARY KEY, name TEXT)`;
    await db`CREATE TABLE student (id TEXT PRIMARY KEY, exam_id TEXT REFERENCES exam(id))`;
    await db`INSERT INTO exam (id, name) VALUES ('e1', 'math')`;
    await db`INSERT INTO student (id, exam_id) VALUES ('s1', 'e1')`;

    for (const statement of splitStatements(sqlText)) {
      await db`${db.unsafe(statement)}`;
    }

    const exams = await db`SELECT id, name FROM exam ORDER BY id`;
    expect(exams.length).toBe(1);
    expect(exams[0]?.id).toBe("e1");
    expect(exams[0]?.name).toBe("math");

    const students = await db`SELECT id, exam_id FROM student ORDER BY id`;
    expect(students.length).toBe(1);
    expect(students[0]?.id).toBe("s1");
    expect(students[0]?.exam_id).toBe("e1");

    await db.close();
  });

  test("sqlite rebuild migration preserves data for renamed foreign key columns", async () => {
    const studentBefore = {
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
    } as const;

    const studentAfter = {
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
          sqlName: "examID",
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
    } as const;

    const examTable = {
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
    } as const;

    const ops: MigrationOperation[] = [
      {
        kind: "rebuild-table",
        fromTable: examTable,
        toTable: examTable,
      },
      {
        kind: "rebuild-table",
        fromTable: studentBefore,
        toTable: studentAfter,
      },
    ];

    const sqlText = buildUpSql("sqlite", ops);

    expect(sqlText).toContain(
      'INSERT INTO "student" ("id", "name", "examID") SELECT "id", "name", "exam_id" FROM "__semola_tmp_student"',
    );

    const db = new SQL("sqlite::memory:");

    await db`PRAGMA foreign_keys = ON`;
    await db`CREATE TABLE exam (id TEXT PRIMARY KEY, name TEXT NOT NULL)`;
    await db`CREATE TABLE student (id TEXT PRIMARY KEY, name TEXT NOT NULL, exam_id TEXT NOT NULL REFERENCES exam(id))`;
    await db`INSERT INTO exam (id, name) VALUES ('e1', 'math')`;
    await db`INSERT INTO student (id, name, exam_id) VALUES ('s1', 'alice', 'e1')`;

    for (const statement of splitStatements(sqlText)) {
      await db`${db.unsafe(statement)}`;
    }

    const students = await db`SELECT id, name, examID FROM student ORDER BY id`;
    expect(students.length).toBe(1);
    expect(students[0]?.id).toBe("s1");
    expect(students[0]?.name).toBe("alice");
    expect(students[0]?.examID).toBe("e1");

    await db.close();
  });
});

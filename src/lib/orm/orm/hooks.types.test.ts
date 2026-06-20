import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { createOrm, one } from "./index.js";
import type { TableRelationsFor } from "./types.js";

const studentsTable = defineTable("students", {
  id: uuid("id").primaryKey().notNull(),
  firstName: string("first_name").notNull(),
});

const examsTable = defineTable("exams", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
});

const studentsToExamsTable = defineTable("students_to_exams", {
  studentId: uuid("student_id")
    .notNull()
    .references(() => studentsTable.columns.id),
  examId: uuid("exam_id")
    .notNull()
    .references(() => examsTable.columns.id),
});

describe("hooks types", () => {
  test("partial relations keep hooks usable for tables without relations", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        students: studentsTable,
        exams: examsTable,
        studentsToExams: studentsToExamsTable,
      },
      relations: {
        studentsToExams: {
          exams: one("examId", () => examsTable),
        },
      },
      hooks: {
        tables: {
          exams: {
            beforeFindMany(ctx) {
              const where = ctx.options?.where;

              if (where) {
                expect(where.name).toBeDefined();
              }
            },
            afterCreate(ctx) {
              const result = ctx.result;

              if (result) {
                expect(result.name).toBeDefined();
                expect(result.id).toBeDefined();
              }
            },
          },
          studentsToExams: {
            beforeFindMany(ctx) {
              const include = ctx.options?.include;

              if (include) {
                expect(include.exams).toBeDefined();
              }
            },
          },
        },
      },
    });

    await orm.$raw`
      CREATE TABLE students (id TEXT PRIMARY KEY NOT NULL, first_name TEXT NOT NULL);
      CREATE TABLE exams (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
      CREATE TABLE students_to_exams (
        student_id TEXT NOT NULL REFERENCES students(id),
        exam_id TEXT NOT NULL REFERENCES exams(id),
        PRIMARY KEY (student_id, exam_id)
      );
    `;

    await orm.students.createMany({ data: [{ id: "S1", firstName: "John" }] });
    await orm.exams.createMany({ data: [{ id: "E1", name: "Math" }] });
    await orm.studentsToExams.createMany({
      data: [{ studentId: "S1", examId: "E1" }],
    });

    await orm.exams.findMany({ where: { name: "Math" } });
    await orm.exams.create({ data: { id: "E2", name: "Physics" } });
    await orm.studentsToExams.findMany({ include: { exams: true } });

    expect(orm.exams).toBeDefined();

    await orm.$raw.close();
  });

  test("TableRelationsFor falls back for omitted relation keys", () => {
    type Relations = {
      studentsToExams: {
        exams: ReturnType<typeof one>;
      };
    };

    type Omitted = TableRelationsFor<Relations, "exams">;
    type Present = TableRelationsFor<Relations, "studentsToExams">;

    const omitted: Omitted = {};
    const present: Present = {
      exams: one("examId", () => examsTable),
    };

    expect(omitted).toEqual({});
    expect(present.exams).toBeDefined();
  });
});

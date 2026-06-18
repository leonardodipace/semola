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
  studentId: uuid("student_id").notNull(),
  examId: uuid("exam_id").notNull(),
});

describe("hooks types", () => {
  test("partial relations keep hooks usable for tables without relations", () => {
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

    expect(orm.exams).toBeDefined();
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

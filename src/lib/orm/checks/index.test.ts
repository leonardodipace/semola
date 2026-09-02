import { describe, expect, test } from "bun:test";
import { date, number, string, uuid } from "../column/index.js";
import { snapshotSchema } from "../migrations/snapshot.js";
import { defineTable } from "../table/index.js";
import { check } from "./index.js";

describe("orm checks", () => {
  test("check builder chains on and where", () => {
    const built = check("posts_age_check").on(number("age")).where("age > 21");

    expect(built.sqlName).toBe("posts_age_check");
    expect(built.expression).toBe("age > 21");
    expect(built.columns.map((column) => column.sqlName)).toEqual(["age"]);
  });

  test("supports where before on", () => {
    const built = check("posts_age_check").where("age > 21").on(number("age"));

    expect(built.expression).toBe("age > 21");
    expect(built.columns[0]?.sqlName).toBe("age");
  });

  test("rejects empty column list", () => {
    expect(() => check("empty_check").where("x = 1").on()).toThrow(
      "Check empty_check requires at least one column",
    );
  });

  test("rejects empty expression", () => {
    expect(() =>
      check("posts_age_check").on(number("age")).where("   "),
    ).toThrow("Check posts_age_check expression cannot be empty");
  });

  test("preserves column order in on()", () => {
    const built = check("order_check").on(
      string("b"),
      string("a"),
      string("c"),
    );

    expect(built.columns.map((column) => column.sqlName)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  test("rejects incomplete check via defineTable", () => {
    expect(() =>
      defineTable({
        sqlName: "posts",
        columns: { age: number("age") },
        checks: (columns) => [check("incomplete_check").on(columns.age)],
      }),
    ).toThrow("Check incomplete_check requires .where(sql)");
  });
});

describe("check builder with defineTable", () => {
  test("rejects check on column not in table at snapshot", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        slug: string("slug").notNull(),
      },
      checks: () => [
        check("bad_check").on(string("missing_col")).where("missing_col > 1"),
      ],
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "Check bad_check references column missing_col which is not on table posts",
    );
  });

  test("rejects duplicate check names on same table at snapshot", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        age: number("age"),
        score: number("score"),
      },
      checks: (columns) => [
        check("dup_check").on(columns.age).where("age > 21"),
        check("dup_check").on(columns.score).where("score > 0"),
      ],
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "Duplicate check name dup_check on table posts",
    );
  });

  test("allows duplicate check names across tables in schema", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: { age: number("age") },
      checks: (columns) => [
        check("shared_check").on(columns.age).where("age > 21"),
      ],
    });
    const pages = defineTable({
      sqlName: "pages",
      columns: { age: number("age") },
      checks: (columns) => [
        check("shared_check").on(columns.age).where("age > 18"),
      ],
    });

    const snapshot = snapshotSchema({ posts, pages });

    expect(snapshot.tables.posts?.checks.shared_check?.expression).toBe(
      "age > 21",
    );
    expect(snapshot.tables.pages?.checks.shared_check?.expression).toBe(
      "age > 18",
    );
  });

  test("snapshot stores column sql names from on()", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        authorId: uuid("author_id").notNull(),
        startedAt: date("started_at").notNull(),
        endedAt: date("ended_at").nullable(),
      },
      checks: (columns) => [
        check("posts_dates_check")
          .on(columns.startedAt, columns.endedAt)
          .where("started_at < ended_at"),
      ],
    });
    const snapshot = snapshotSchema({ posts });

    expect(snapshot.tables.posts?.checks.posts_dates_check?.columns).toEqual([
      "started_at",
      "ended_at",
    ]);
  });
});

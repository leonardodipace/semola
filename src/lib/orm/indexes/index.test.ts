import { describe, expect, test } from "bun:test";
import { date, string, uuid } from "../column/index.js";
import { snapshotSchema } from "../migrations/snapshot.js";
import { defineTable } from "../table/index.js";
import { index, uniqueIndex } from "./index.js";

describe("orm indexes", () => {
  test("index builder chains on and where", () => {
    const built = index("posts_author_idx")
      .on(uuid("author_id"), string("created_at"))
      .where("deleted_at IS NULL");

    expect(built.sqlName).toBe("posts_author_idx");
    expect(built.unique).toBe(false);
    expect(built.where).toBe("deleted_at IS NULL");
    expect(built.columns).toHaveLength(2);
    expect(built.columns[0]?.sqlName).toBe("author_id");
  });

  test("uniqueIndex sets unique and supports unique()", () => {
    const fromHelper = uniqueIndex("posts_slug_idx").on(string("slug"));
    const fromChain = index("posts_slug_idx").unique().on(string("slug"));

    expect(fromHelper.unique).toBe(true);
    expect(fromChain.unique).toBe(true);
  });

  test("rejects empty column list", () => {
    expect(() => index("empty_idx").on()).toThrow(
      "Index empty_idx requires at least one column",
    );
  });

  test("rejects empty where clause", () => {
    expect(() => index("partial_idx").where("   ").on(string("slug"))).toThrow(
      "Index partial_idx where clause cannot be empty",
    );
  });

  test("defineTable resolves indexes callback", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        authorId: uuid("author_id").notNull(),
        slug: string("slug").notNull(),
      },
      indexes: (columns) => [
        index("posts_author_idx").on(columns.authorId),
        uniqueIndex("posts_slug_idx").on(columns.slug),
      ],
    });

    expect(posts.indexes).toHaveLength(2);
    expect(posts.indexes?.[0]?.sqlName).toBe("posts_author_idx");
    expect(posts.indexes?.[1]?.unique).toBe(true);
  });
});

describe("index builder", () => {
  test("supports where before on", () => {
    const built = index("partial_idx")
      .where("active = true")
      .on(string("status"));

    expect(built.where).toBe("active = true");
    expect(built.columns).toHaveLength(1);
    expect(built.columns[0]?.sqlName).toBe("status");
  });

  test("supports on before where", () => {
    const built = index("partial_idx")
      .on(string("status"))
      .where("active = true");

    expect(built.where).toBe("active = true");
    expect(built.columns[0]?.sqlName).toBe("status");
  });

  test("defaults unique to false", () => {
    const built = index("plain_idx").on(string("name"));

    expect(built.unique).toBe(false);
  });

  test("unique chain sets unique before on", () => {
    const built = index("slug_idx").unique().on(string("slug"));

    expect(built.unique).toBe(true);
    expect(built.sqlName).toBe("slug_idx");
  });

  test("unique chain with where and on", () => {
    const built = index("active_slug_idx")
      .unique()
      .where("deleted_at IS NULL")
      .on(string("slug"));

    expect(built.unique).toBe(true);
    expect(built.where).toBe("deleted_at IS NULL");
    expect(built.columns[0]?.sqlName).toBe("slug");
  });

  test("builds composite index with two columns", () => {
    const built = index("pair_idx").on(uuid("author_id"), date("created_at"));

    expect(built.columns).toHaveLength(2);
    expect(built.columns[0]?.sqlName).toBe("author_id");
    expect(built.columns[1]?.sqlName).toBe("created_at");
  });

  test("builds composite index with three columns", () => {
    const built = index("triple_idx").on(
      uuid("org_id"),
      uuid("user_id"),
      date("created_at"),
    );

    expect(built.columns).toHaveLength(3);
    expect(built.columns.map((column) => column.sqlName)).toEqual([
      "org_id",
      "user_id",
      "created_at",
    ]);
  });

  test("preserves column order in on()", () => {
    const built = index("order_idx").on(string("b"), string("a"), string("c"));

    expect(built.columns.map((column) => column.sqlName)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  test("uniqueIndex sets unique without chaining unique()", () => {
    const built = uniqueIndex("slug_idx").on(string("slug"));

    expect(built.unique).toBe(true);
    expect(built.sqlName).toBe("slug_idx");
  });

  test("rejects empty on() after where", () => {
    expect(() => index("empty_idx").where("x = 1").on()).toThrow(
      "Index empty_idx requires at least one column",
    );
  });

  test("rejects empty where after on", () => {
    expect(() => index("partial_idx").on(string("slug")).where("   ")).toThrow(
      "Index partial_idx where clause cannot be empty",
    );
  });

  test("rejects empty where before on", () => {
    expect(() => index("partial_idx").where("\t\n").on(string("slug"))).toThrow(
      "Index partial_idx where clause cannot be empty",
    );
  });

  test("rejects empty column list on uniqueIndex", () => {
    expect(() => uniqueIndex("empty_idx").on()).toThrow(
      "Index empty_idx requires at least one column",
    );
  });

  test("stores sqlName on built index", () => {
    const built = index("my_custom_name").on(string("col"));

    expect(built.sqlName).toBe("my_custom_name");
  });

  test("partial index keeps full where expression", () => {
    const expr = "deleted_at IS NULL AND status = 'active'";
    const built = index("complex_partial").on(string("author_id")).where(expr);

    expect(built.where).toBe(expr);
  });
});

describe("index builder with defineTable", () => {
  test("resolves table columns in index callback", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        authorId: uuid("author_id").notNull(),
        createdAt: date("created_at").notNull(),
      },
      indexes: (columns) => [
        index("posts_author_created_idx").on(
          columns.authorId,
          columns.createdAt,
        ),
      ],
    });

    expect(posts.indexes?.[0]?.columns.map((column) => column.sqlName)).toEqual(
      ["author_id", "created_at"],
    );
  });

  test("rejects index on column not in table at snapshot", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        slug: string("slug").notNull(),
      },
      indexes: () => [index("bad_idx").on(string("missing_col"))],
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "Index bad_idx references column missing_col which is not on table posts",
    );
  });

  test("rejects duplicate index names on same table at snapshot", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        slug: string("slug").notNull(),
        title: string("title").notNull(),
      },
      indexes: (columns) => [
        index("dup_idx").on(columns.slug),
        index("dup_idx").on(columns.title),
      ],
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "Duplicate index name dup_idx on table posts",
    );
  });
});

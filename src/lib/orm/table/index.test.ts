import { describe, expect, test } from "bun:test";
import { date, string, uuid } from "../column/index.js";
import { index, uniqueIndex } from "../indexes/index.js";
import { snapshotSchema } from "../migrations/snapshot.js";
import { defineTable } from "./index.js";

describe("defineTable", () => {
  test("returns a table definition with sqlName and columns", () => {
    const columns = {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    };

    const table = defineTable({ sqlName: "users", columns });

    expect(table.sqlName).toBe("users");
    expect(table.columns).toBe(columns);
    expect(table.columns.id.sqlName).toBe("id");
    expect(table.columns.name.sqlName).toBe("name");
  });
});

describe("defineTable indexes", () => {
  test("omits indexes when callback not provided", () => {
    const table = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
    });

    expect(table.indexes).toBeUndefined();
  });

  test("resolves indexes callback with table columns", () => {
    const table = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").notNull(),
        slug: string("slug").notNull(),
        createdAt: date("created_at").notNull(),
      },
      indexes: (columns) => [
        index("posts_author_created_idx").on(
          columns.authorId,
          columns.createdAt,
        ),
        uniqueIndex("posts_slug_idx").on(columns.slug),
        index("posts_active_author_idx")
          .on(columns.authorId)
          .where("deleted_at IS NULL"),
      ],
    });

    expect(table.indexes).toHaveLength(3);
    expect(table.indexes?.[0]?.sqlName).toBe("posts_author_created_idx");
    expect(table.indexes?.[1]?.unique).toBe(true);
    expect(table.indexes?.[2]?.where).toBe("deleted_at IS NULL");
  });

  test("allows empty indexes array", () => {
    const table = defineTable({
      sqlName: "users",
      columns: {
        id: uuid("id").primaryKey().notNull(),
      },
      indexes: () => [],
    });

    expect(table.indexes).toEqual([]);
  });

  test("supports multiple indexes on same table", () => {
    const table = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        authorId: uuid("author_id").notNull(),
        slug: string("slug").notNull(),
      },
      indexes: (columns) => [
        index("posts_author_idx").on(columns.authorId),
        uniqueIndex("posts_slug_idx").on(columns.slug),
        index("posts_author_slug_idx").on(columns.authorId, columns.slug),
      ],
    });

    expect(table.indexes).toHaveLength(3);
    expect(table.indexes?.map((entry) => entry.sqlName)).toEqual([
      "posts_author_idx",
      "posts_slug_idx",
      "posts_author_slug_idx",
    ]);
  });

  test("rejects duplicate index names on same table at snapshot", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        slug: string("slug").notNull(),
        title: string("title").notNull(),
      },
      indexes: (columns) => [
        index("same_name").on(columns.slug),
        index("same_name").on(columns.title),
      ],
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "Duplicate index name same_name on table posts",
    );
  });

  test("rejects duplicate index names across tables in schema", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        slug: string("slug").notNull(),
      },
      indexes: (columns) => [index("shared_idx").on(columns.slug)],
    });
    const pages = defineTable({
      sqlName: "pages",
      columns: {
        slug: string("slug").notNull(),
      },
      indexes: (columns) => [index("shared_idx").on(columns.slug)],
    });

    expect(() => snapshotSchema({ posts, pages })).toThrow("shared_idx");
  });

  test("rejects index referencing column outside table at snapshot", () => {
    const posts = defineTable({
      sqlName: "posts",
      columns: {
        slug: string("slug").notNull(),
      },
      indexes: () => [index("bad_idx").on(string("author_id"))],
    });

    expect(() => snapshotSchema({ posts })).toThrow(
      "Index bad_idx references column author_id which is not on table posts",
    );
  });

  test("column unique is separate from uniqueIndex", () => {
    const table = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        slug: string("slug").notNull().unique(),
      },
      indexes: (columns) => [index("posts_slug_lookup").on(columns.slug)],
    });

    expect(table.columns.slug._meta.isUnique).toBe(true);
    expect(table.indexes?.[0]?.unique).toBe(false);
  });

  test("finalize resolves index columns from table definition", () => {
    const table = defineTable({
      sqlName: "posts",
      columns: {
        authorId: uuid("author_id").notNull(),
      },
      indexes: (columns) => [index("posts_author_idx").on(columns.authorId)],
    });

    expect(table.indexes?.[0]?.columns[0]).toBe(table.columns.authorId);
  });
});

import { describe, expect, test } from "bun:test";
import { number, string } from "../column/index.js";
import { Table } from "../table/index.js";
import { many, one } from "./index.js";

describe("Relations - one()", () => {
  test("should create a OneRelation", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const relation = one("authorId", () => usersTable);

    expect(relation.type).toBe("one");
    expect(relation.fkColumn).toBe("authorId");
    expect(relation.table).toBeInstanceOf(Function);
    expect(relation.table()).toBe(usersTable);
  });

  test("should accept different FK column names", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
    });

    const relation1 = one("userId", () => usersTable);
    const relation2 = one("author_id", () => usersTable);
    const relation3 = one("createdBy", () => usersTable);

    expect(relation1.fkColumn).toBe("userId");
    expect(relation2.fkColumn).toBe("author_id");
    expect(relation3.fkColumn).toBe("createdBy");
  });

  test("should use lazy table reference", () => {
    let tableCreated = false;
    const getTable = () => {
      tableCreated = true;
      return new Table("users", {
        id: number("id").primaryKey(),
      });
    };

    const relation = one("userId", getTable);

    // Table should not be created yet
    expect(tableCreated).toBe(false);

    // Access the table
    const table = relation.table();

    // Now table should be created
    expect(tableCreated).toBe(true);
    expect(table).toBeInstanceOf(Table);
  });
});

describe("Relations - many()", () => {
  test("should create a ManyRelation", () => {
    const postsTable = new Table("posts", {
      id: number("id").primaryKey(),
      title: string("title").notNull(),
    });

    const relation = many("authorId", () => postsTable);

    expect(relation.type).toBe("many");
    expect(relation.fkColumn).toBe("authorId");
    expect(relation.table).toBeInstanceOf(Function);
    expect(relation.table()).toBe(postsTable);
  });

  test("should accept different FK column names", () => {
    const postsTable = new Table("posts", {
      id: number("id").primaryKey(),
    });

    const relation1 = many("userId", () => postsTable);
    const relation2 = many("author_id", () => postsTable);
    const relation3 = many("parentId", () => postsTable);

    expect(relation1.fkColumn).toBe("userId");
    expect(relation2.fkColumn).toBe("author_id");
    expect(relation3.fkColumn).toBe("parentId");
  });

  test("should use lazy table reference", () => {
    let tableCreated = false;
    const getTable = () => {
      tableCreated = true;
      return new Table("posts", {
        id: number("id").primaryKey(),
      });
    };

    const relation = many("userId", getTable);

    // Table should not be created yet
    expect(tableCreated).toBe(false);

    // Access the table
    const table = relation.table();

    // Now table should be created
    expect(tableCreated).toBe(true);
    expect(table).toBeInstanceOf(Table);
  });
});

describe("Relations - type differences", () => {
  test("one() and many() should have different types", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
    });

    const postsTable = new Table("posts", {
      id: number("id").primaryKey(),
    });

    const oneRel = one("authorId", () => usersTable);
    const manyRel = many("authorId", () => postsTable);

    expect(oneRel.type).toBe("one");
    expect(manyRel.type).toBe("many");
    expect(oneRel.type).not.toBe(manyRel.type);
  });
});

describe("Relations - circular references", () => {
  test("should support circular table references", () => {
    let usersTable: Table;
    let postsTable: Table;

    usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    postsTable = new Table("posts", {
      id: number("id").primaryKey(),
      title: string("title").notNull(),
      authorId: number("author_id").notNull(),
    });

    // Relations that reference each other
    const userPosts = many("authorId", () => postsTable);
    const postAuthor = one("authorId", () => usersTable);

    expect(userPosts.table()).toBe(postsTable);
    expect(postAuthor.table()).toBe(usersTable);
  });

  test("should support self-referential relations", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      managerId: number("manager_id"),
    });

    const manager = one("managerId", () => usersTable);
    const reports = many("managerId", () => usersTable);

    expect(manager.table()).toBe(usersTable);
    expect(reports.table()).toBe(usersTable);
  });
});

import { beforeAll, describe, expect, test } from "bun:test";
import { number, string } from "../column/index.js";
import { many, one } from "../relations/index.js";
import { Table } from "../table/index.js";
import { Orm } from "./index.js";

describe("Orm - initialization", () => {
  test("should create Orm instance with tables", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: {
        users: usersTable,
      },
    });

    expect(orm).toBeDefined();
    expect(orm.sql).toBeDefined();
    expect(orm.tables).toBeDefined();
    expect(orm.tables.users).toBeDefined();
  });

  test("should create Orm instance with multiple tables", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const postsTable = new Table("posts", {
      id: number("id").primaryKey(),
      title: string("title").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: {
        users: usersTable,
        posts: postsTable,
      },
    });

    expect(orm.tables.users).toBeDefined();
    expect(orm.tables.posts).toBeDefined();
  });

  test("should create Orm instance with relations", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const postsTable = new Table("posts", {
      id: number("id").primaryKey(),
      title: string("title").notNull(),
      authorId: number("author_id").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: {
        users: usersTable,
        posts: postsTable,
      },
      relations: {
        users: {
          posts: many("authorId", () => postsTable),
        },
        posts: {
          author: one("authorId", () => usersTable),
        },
      },
    });

    expect(orm.tables.users).toBeDefined();
    expect(orm.tables.posts).toBeDefined();
  });
});

describe("Orm - table clients", () => {
  const usersTable = new Table("test_orm_users", {
    id: number("id").primaryKey(),
    name: string("name").notNull(),
    email: string("email").unique().notNull(),
  });

  const orm = new Orm({
    url: ":memory:",
    tables: {
      users: usersTable,
    },
  });

  beforeAll(async () => {
    // Cleanup
    await orm.sql`DROP TABLE IF EXISTS test_orm_users`;

    // Create table
    await orm.sql`
      CREATE TABLE test_orm_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
      )
    `;
  });

  test("table clients should have query methods", () => {
    expect(orm.tables.users.findMany).toBeDefined();
    expect(orm.tables.users.findFirst).toBeDefined();
    expect(orm.tables.users.findUnique).toBeDefined();
  });

  test("should be able to query through table clients", async () => {
    // Insert test data
    await orm.sql`
      INSERT INTO test_orm_users (name, email)
      VALUES ('Alice', 'alice@test.com')
    `;

    const users = await orm.tables.users.findMany();
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]?.name).toBe("Alice");
    expect(users[0]?.email).toBe("alice@test.com");
  });

  test("multiple table clients should work independently", async () => {
    const postsTable = new Table("test_orm_posts", {
      id: number("id").primaryKey(),
      title: string("title").notNull(),
    });

    // Create a combined ORM with both tables
    const orm2 = new Orm({
      url: ":memory:",
      tables: {
        users: usersTable,
        posts: postsTable,
      },
    });

    // Create users table
    await orm2.sql`DROP TABLE IF EXISTS test_orm_users`;
    await orm2.sql`
      CREATE TABLE test_orm_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
      )
    `;

    // Insert test user
    await orm2.sql`
      INSERT INTO test_orm_users (name, email) VALUES ('TestUser', 'test@example.com')
    `;

    // Create posts table
    await orm2.sql`DROP TABLE IF EXISTS test_orm_posts`;
    await orm2.sql`
      CREATE TABLE test_orm_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      )
    `;

    await orm2.sql`
      INSERT INTO test_orm_posts (title) VALUES ('Test Post')
    `;

    const users = await orm2.tables.users.findMany();
    const posts = await orm2.tables.posts.findMany();

    expect(users.length).toBeGreaterThan(0);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]?.title).toBe("Test Post");
  });
});

describe("Orm - SQL access", () => {
  test("should provide direct SQL access", async () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: { users: usersTable },
    });

    expect(orm.sql).toBeDefined();
    expect(typeof orm.sql).toBe("function");
  });
});

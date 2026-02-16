import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boolean, number, string } from "../column/index.js";
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

  afterAll(async () => {
    await orm.sql`DROP TABLE IF EXISTS test_orm_users`;
    orm.close();
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

    const [error, users] = await orm.tables.users.findMany();
    expect(error).toBeNull();
    expect(users).toBeDefined();
    expect(users?.length).toBeGreaterThan(0);
    expect(users?.[0]?.name).toBe("Alice");
    expect(users?.[0]?.email).toBe("alice@test.com");
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

    const [usersError, users] = await orm2.tables.users.findMany();
    const [postsError, posts] = await orm2.tables.posts.findMany();

    expect(usersError).toBeNull();
    expect(postsError).toBeNull();
    expect(users?.length).toBeGreaterThan(0);
    expect(posts?.length).toBeGreaterThan(0);
    expect(posts?.[0]?.title).toBe("Test Post");

    orm2.close();
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

    orm.close();
  });
});

describe("Orm - DDL generation", () => {
  test("should generate CREATE TABLE statement with SQLite dialect", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
      email: string("email").unique(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: { users: usersTable },
    });

    const [error, sql] = orm.createTable(usersTable);

    expect(error).toBeNull();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(sql).toContain("id INTEGER PRIMARY KEY");
    expect(sql).toContain("name TEXT NOT NULL");
    expect(sql).toContain("email TEXT UNIQUE");

    orm.close();
  });

  test("should generate DDL with all column types", () => {
    const testTable = new Table("test_types", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
      active: boolean("is_active").default(true),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: { test: testTable },
    });

    const [error, ddl] = orm.createTable(testTable);

    expect(error).toBeNull();
    expect(ddl).toContain("id INTEGER PRIMARY KEY");
    expect(ddl).toContain("name TEXT NOT NULL");
    expect(ddl).toContain("is_active INTEGER");

    orm.close();
  });
});

describe("Orm - dialect support", () => {
  test("should use SQLite dialect by default", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: { users: usersTable },
    });

    const [error, sql] = orm.createTable(usersTable);

    expect(error).toBeNull();
    // SQLite uses INTEGER for numbers
    expect(sql).toContain("INTEGER");

    orm.close();
  });

  test("should accept explicit SQLite dialect", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: { users: usersTable },
      dialect: "sqlite",
    });

    expect(orm).toBeDefined();

    orm.close();
  });

  test("should support Postgres dialect", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: { users: usersTable },
      dialect: "postgres",
    });

    const [error, createTableSql] = orm.createTable(usersTable);
    expect(error).toBeNull();
    expect(createTableSql).toContain("BIGSERIAL PRIMARY KEY");
    expect(createTableSql).toContain("name TEXT NOT NULL");

    orm.close();
  });

  test("should support MySQL dialect", () => {
    const usersTable = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      tables: { users: usersTable },
      dialect: "mysql",
    });

    const [error, createTableSql] = orm.createTable(usersTable);
    expect(error).toBeNull();
    expect(createTableSql).toContain("BIGINT AUTO_INCREMENT PRIMARY KEY");
    expect(createTableSql).toContain("name VARCHAR(255) NOT NULL");

    orm.close();
  });
});

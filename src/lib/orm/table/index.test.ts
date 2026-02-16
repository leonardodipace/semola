import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boolean, date, number, string } from "../column/index.js";
import { Orm } from "../index.js";
import { many, one } from "../relations/index.js";
import { Table } from "./index.js";
import type { CreateInput } from "./types.js";

const usersTable = new Table("test_users", {
  id: number("id").primaryKey(),
  name: string("name").notNull(),
  email: string("email").unique().notNull(),
  active: boolean("active").default(true),
  // Static value only for type metadata; SQL default remains in schema setup.
  createdAt: date("created_at").default(new Date(0)),
});

const postsTable = new Table("test_posts", {
  id: number("id").primaryKey(),
  title: string("title").notNull(),
  content: string("content").notNull(),
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

describe("Table - findMany with where clause", () => {
  beforeAll(async () => {
    // Cleanup test tables
    await orm.sql`DROP TABLE IF EXISTS test_posts`;
    await orm.sql`DROP TABLE IF EXISTS test_users`;

    // Create tables
    await orm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await orm.sql`
      CREATE TABLE test_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        FOREIGN KEY (author_id) REFERENCES test_users(id)
      )
    `;

    // Insert test data
    await orm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES
        ('Alice', 'alice@example.com', true),
        ('Bob', 'bob@example.com', false),
        ('Charlie', 'charlie@example.com', true),
        ('Diana', 'diana@example.com', false)
    `;

    await orm.sql`
      INSERT INTO test_posts (title, content, author_id)
      VALUES
        ('Post 1', 'Content 1', 1),
        ('Post 2', 'Content 2', 1),
        ('Post 3', 'Content 3', 2),
        ('Post 4', 'Content 4', 3)
    `;
  });

  test("should return all rows when no where clause is provided", async () => {
    const users = await orm.tables.users.findMany();
    expect(users.length).toBe(4);
  });

  test("should filter by single condition", async () => {
    const users = await orm.tables.users.findMany({
      where: { name: "Alice" },
    });
    expect(users.length).toBe(1);
    expect(users[0]?.name).toBe("Alice");
    expect(users[0]?.email).toBe("alice@example.com");
  });

  test("should filter by multiple conditions (AND)", async () => {
    const users = await orm.tables.users.findMany({
      where: { name: "Bob", active: false },
    });
    expect(users.length).toBe(1);
    expect(users[0]?.name).toBe("Bob");
    expect(users[0]?.active).toBe(false);
  });

  test("should filter by boolean value", async () => {
    const activeUsers = await orm.tables.users.findMany({
      where: { active: true },
    });
    expect(activeUsers.length).toBe(2);
    expect(activeUsers.every((u) => u.active)).toBe(true);

    const inactiveUsers = await orm.tables.users.findMany({
      where: { active: false },
    });
    expect(inactiveUsers.length).toBe(2);
    expect(inactiveUsers.every((u) => !u.active)).toBe(true);
  });

  test("should return empty array when no matches found", async () => {
    const users = await orm.tables.users.findMany({
      where: { name: "NonExistent" },
    });
    expect(users.length).toBe(0);
  });

  test("should handle null values with IS NULL", async () => {
    // Create a table with nullable columns for this test
    await orm.sql`DROP TABLE IF EXISTS test_nullable`;
    await orm.sql`
      CREATE TABLE test_nullable (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        value INTEGER
      )
    `;
    await orm.sql`
      INSERT INTO test_nullable (name, value)
      VALUES
        ('has_value', 100),
        (NULL, 200),
        ('another', NULL)
    `;

    const nullableTable = new Table("test_nullable", {
      id: number("id").primaryKey(),
      name: string("name"),
      value: number("value"),
    });

    // Create client using the same orm's sql connection
    const { TableClient } = await import("./index.js");
    const { SqliteDialect } = await import("../dialect/sqlite.js");
    const nullableClient = new TableClient(
      orm.sql,
      nullableTable,
      new SqliteDialect(),
    );

    const nullNameRows = await nullableClient.findMany({
      where: { name: null },
    });
    expect(nullNameRows.length).toBe(1);
    expect(nullNameRows[0]?.value).toBe(200);

    const nullValueRows = await nullableClient.findMany({
      where: { value: null },
    });
    expect(nullValueRows.length).toBe(1);
    expect(nullValueRows[0]?.name).toBe("another");

    // Cleanup
    await orm.sql`DROP TABLE IF EXISTS test_nullable`;
  });

  test("should prevent SQL injection in string values", async () => {
    const maliciousName = "Alice'; DROP TABLE test_users; --";

    // This should safely escape the value, not execute the SQL injection
    const users = await orm.tables.users.findMany({
      where: { name: maliciousName },
    });

    // Should return no results (or 0 if the malicious string doesn't match any real data)
    expect(users.length).toBe(0);

    // Verify table still exists by querying it
    const allUsers = await orm.tables.users.findMany();
    expect(allUsers.length).toBe(4); // Original 4 users should still be there
  });

  test("should throw error for invalid column names", async () => {
    expect(
      orm.tables.users.findMany({
        // @ts-expect-error - invalidColumn doesn't exist on users table
        where: { invalidColumn: "value" },
      }),
    ).rejects.toThrow("Invalid column: invalidColumn");
  });

  test("should filter with equals operator", async () => {
    const users = await orm.tables.users.findMany({
      where: { name: { equals: "Alice" } },
    });
    expect(users.length).toBe(1);
    expect(users[0]?.name).toBe("Alice");

    // Test with boolean
    const activeUsers = await orm.tables.users.findMany({
      where: { active: { equals: true } },
    });
    expect(activeUsers.length).toBe(2);
  });

  test("should filter with contains operator (case insensitive)", async () => {
    const users = await orm.tables.users.findMany({
      where: { name: { contains: "ali" } },
    });
    expect(users.length).toBe(1);
    expect(users[0]?.name).toBe("Alice");

    // Test case insensitivity
    const usersUpper = await orm.tables.users.findMany({
      where: { name: { contains: "ALI" } },
    });
    expect(usersUpper.length).toBe(1);
  });

  test("should filter with gt operator", async () => {
    // Insert test data with known IDs
    await orm.sql`DELETE FROM test_posts`;
    await orm.sql`DELETE FROM test_users`;
    await orm.sql`
      INSERT INTO test_users (id, name, email, active)
      VALUES
        (1, 'User1', 'user1@example.com', true),
        (2, 'User2', 'user2@example.com', true),
        (3, 'User3', 'user3@example.com', true)
    `;

    const users = await orm.tables.users.findMany({
      where: { id: { gt: 1 } },
    });
    expect(users.length).toBe(2);
    expect(users.every((u) => u.id > 1)).toBe(true);
  });

  test("should filter with gte operator", async () => {
    const users = await orm.tables.users.findMany({
      where: { id: { gte: 2 } },
    });
    expect(users.length).toBe(2);
    expect(users.every((u) => u.id >= 2)).toBe(true);
  });

  test("should filter with lt operator", async () => {
    const users = await orm.tables.users.findMany({
      where: { id: { lt: 3 } },
    });
    expect(users.length).toBe(2);
    expect(users.every((u) => u.id < 3)).toBe(true);
  });

  test("should filter with lte operator", async () => {
    const users = await orm.tables.users.findMany({
      where: { id: { lte: 2 } },
    });
    expect(users.length).toBe(2);
    expect(users.every((u) => u.id <= 2)).toBe(true);
  });

  test("should filter with multiple operators combined", async () => {
    // ID between 1 and 2 (inclusive)
    const users = await orm.tables.users.findMany({
      where: { id: { gte: 1, lte: 2 } },
    });
    expect(users.length).toBe(2);
    expect(users.every((u) => u.id >= 1 && u.id <= 2)).toBe(true);
  });

  test("should combine direct values and operators", async () => {
    // Setup test data (3 users, all active)
    await orm.sql`DELETE FROM test_posts`;
    await orm.sql`DELETE FROM test_users`;
    await orm.sql`
      INSERT INTO test_users (id, name, email, active)
      VALUES
        (1, 'User1', 'user1@example.com', true),
        (2, 'User2', 'user2@example.com', true),
        (3, 'User3', 'user3@example.com', true)
    `;

    const users = await orm.tables.users.findMany({
      where: {
        active: true,
        id: { gte: 2 },
      },
    });
    expect(users.length).toBe(2);
    expect(users.every((u) => u.active && u.id >= 2)).toBe(true);

    // Restore original test data for subsequent tests
    await orm.sql`DELETE FROM test_posts`;
    await orm.sql`DELETE FROM test_users`;
    await orm.sql`DELETE FROM sqlite_sequence WHERE name='test_users'`;
    await orm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES
        ('Alice', 'alice@example.com', true),
        ('Bob', 'bob@example.com', false),
        ('Charlie', 'charlie@example.com', true),
        ('Diana', 'diana@example.com', false)
    `;
    await orm.sql`
      INSERT INTO test_posts (title, content, author_id)
      VALUES
        ('Post 1', 'Content 1', 1),
        ('Post 2', 'Content 2', 1),
        ('Post 3', 'Content 3', 2),
        ('Post 4', 'Content 4', 3)
    `;
  });

  test("findFirst should return first matching row", async () => {
    const user = await orm.tables.users.findFirst({
      where: { active: true },
    });
    expect(user).not.toBeNull();
    expect(user?.active).toBe(true);
  });

  test("findFirst should return null when no matches found", async () => {
    const user = await orm.tables.users.findFirst({
      where: { name: "NonExistent" },
    });
    expect(user).toBeNull();
  });

  test("findFirst without where should return first row", async () => {
    const user = await orm.tables.users.findFirst();
    expect(user).not.toBeNull();
  });

  test("findUnique should return row by primary key", async () => {
    const user = await orm.tables.users.findUnique({
      where: { id: 1 },
    });
    expect(user).not.toBeNull();
    expect(user?.id).toBe(1);
  });

  test("findUnique should return row by unique field", async () => {
    const user = await orm.tables.users.findUnique({
      where: { email: "alice@example.com" },
    });
    expect(user).not.toBeNull();
    expect(user?.email).toBe("alice@example.com");
  });

  test("findUnique should return null when not found", async () => {
    const user = await orm.tables.users.findUnique({
      where: { id: 999 },
    });
    expect(user).toBeNull();
  });

  test("findUnique should throw error for non-unique column", async () => {
    expect(
      orm.tables.users.findUnique({
        where: { active: { equals: true } },
      }),
    ).rejects.toThrow('Column "active" is not a primary key or unique column');
  });

  test("findUnique should throw error for multiple columns", async () => {
    expect(
      orm.tables.users.findUnique({
        where: { id: 1, email: "test@example.com" },
      }),
    ).rejects.toThrow("findUnique requires exactly one column in where clause");
  });

  test("findMany with take should limit results", async () => {
    const users = await orm.tables.users.findMany({
      take: 2,
    });
    expect(users.length).toBe(2);
  });

  test("findMany with skip should skip results", async () => {
    const allUsers = await orm.tables.users.findMany();
    const skipped = await orm.tables.users.findMany({
      skip: 2,
    });
    expect(skipped.length).toBe(allUsers.length - 2);
    expect(skipped[0]?.id).toBe(allUsers[2]?.id);
  });

  test("findMany with take and skip should paginate", async () => {
    const page1 = await orm.tables.users.findMany({
      take: 2,
      skip: 0,
    });
    const page2 = await orm.tables.users.findMany({
      take: 2,
      skip: 2,
    });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  test("findMany with where and pagination should work together", async () => {
    const users = await orm.tables.users.findMany({
      where: { active: true },
      take: 1,
    });
    expect(users.length).toBeLessThanOrEqual(1);
    expect(users.every((u) => u.active)).toBe(true);
  });

  test("findMany with include should load one() relations", async () => {
    const posts = await orm.tables.posts.findMany({
      include: { author: true },
    });
    expect(posts.length).toBeGreaterThan(0);

    const [post] = posts;
    expect(post?.author).toBeDefined();
    expect(post?.author?.name).toBeDefined();
    expect(post?.author?.email).toBeDefined();
  });

  test("findFirst with include should load one() relations", async () => {
    const post = await orm.tables.posts.findFirst({
      include: { author: true },
    });
    if (post) {
      expect(post.author).toBeDefined();
      expect(post.author?.name).toBeDefined();
    }
  });

  test("findUnique with include should load one() relations", async () => {
    const post = await orm.tables.posts.findUnique({
      where: { id: 1 },
      include: { author: true },
    });
    if (post) {
      expect(post.author).toBeDefined();
      expect(post.author?.name).toBe("Alice");
    }
  });

  test("findMany with include should load many() relations", async () => {
    const users = await orm.tables.users.findMany({
      include: { posts: true },
    });
    expect(users.length).toBeGreaterThan(0);
    const alice = users.find((u) => u.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice?.posts).toBeDefined();
    expect(Array.isArray(alice?.posts)).toBe(true);
    expect(alice?.posts.length).toBe(2); // Alice has 2 posts
    expect(alice?.posts.every((p) => p.authorId === alice.id)).toBe(true);
  });

  test("findFirst with include should load many() relations", async () => {
    const user = await orm.tables.users.findFirst({
      where: { name: "Alice" },
      include: { posts: true },
    });
    if (user) {
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBe(2);
    }
  });

  test("findUnique with include should load many() relations", async () => {
    const user = await orm.tables.users.findUnique({
      where: { id: 1 },
      include: { posts: true },
    });
    if (user) {
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBe(2);
    }
  });

  test("many() relations should return empty array when no related records", async () => {
    const user = await orm.tables.users.findUnique({
      where: { id: 4 }, // Diana has no posts
      include: { posts: true },
    });
    if (user) {
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBe(0);
    }
  });
});
describe("Table - create method", () => {
  test("should create a new user with required fields", async () => {
    const newUser = await orm.tables.users.create({
      name: "Eve",
      email: "eve@example.com",
    });

    expect(newUser.id).toBeDefined();
    expect(newUser.name).toBe("Eve");
    expect(newUser.email).toBe("eve@example.com");
    expect(newUser.active).toBe(true); // Default value
  });

  test("should create a user with optional fields set", async () => {
    const newUser = await orm.tables.users.create({
      name: "Frank",
      email: "frank@example.com",
      active: false,
    });

    expect(newUser.name).toBe("Frank");
    expect(newUser.email).toBe("frank@example.com");
    expect(newUser.active).toBe(false);
  });

  test("should throw error when required field is missing", async () => {
    // @ts-expect-error - missing required fields
    const invalidCreate = orm.tables.users.create({
      email: "invalid@example.com",
    });

    await expect(invalidCreate).rejects.toThrow();
  });
});

describe("Table - update method", () => {
  test("should update a user by id", async () => {
    const updated = await orm.tables.users.update({
      where: { id: 1 },
      data: { name: "Alice Updated" },
    });

    expect(updated.length).toBe(1);
    expect(updated[0]?.name).toBe("Alice Updated");
  });

  test("should update multiple fields", async () => {
    const updated = await orm.tables.users.update({
      where: { id: 2 },
      data: { name: "Bob Updated", active: true },
    });

    expect(updated.length).toBe(1);
    expect(updated[0]?.name).toBe("Bob Updated");
    expect(updated[0]?.active).toBe(true);
  });

  test("should update multiple users matching condition", async () => {
    const updated = await orm.tables.users.update({
      where: { active: false },
      data: { active: true },
    });

    expect(updated.length).toBeGreaterThan(1);
    expect(updated.every((u) => u.active === true)).toBe(true);
  });

  test("should throw error when where clause is missing", async () => {
    // @ts-expect-error - missing where clause
    const invalidUpdate = orm.tables.users.update({
      data: { name: "Test" },
    });

    await expect(invalidUpdate).rejects.toThrow();
  });
});

describe("Table - delete method", () => {
  test("should delete a user by id", async () => {
    // First create a user to delete
    const newUser = await orm.tables.users.create({
      name: "ToDelete",
      email: "todelete@example.com",
    });

    const count = await orm.tables.users.delete({
      where: { id: newUser.id },
    });

    expect(count).toBe(1);

    // Verify it's deleted
    const found = await orm.tables.users.findFirst({
      where: { id: newUser.id },
    });
    expect(found).toBeNull();
  });

  test("should delete multiple users matching condition", async () => {
    // Create two users to delete
    await orm.tables.users.create({
      name: "Delete1",
      email: "delete1@example.com",
      active: false,
    });

    await orm.tables.users.create({
      name: "Delete2",
      email: "delete2@example.com",
      active: false,
    });

    const count = await orm.tables.users.delete({
      where: { name: { in: ["Delete1", "Delete2"] } },
    });

    expect(count).toBe(2);
  });

  test("should throw error when where clause is missing", async () => {
    // @ts-expect-error - missing where clause
    await expect(orm.tables.users.delete({})).rejects.toThrow();
  });
});

describe("Table - CreateInput type validation", () => {
  test("should infer required fields correctly", () => {
    const testTable = new Table("test", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      active: boolean("active").default(true),
      // Static value only for type metadata; SQL default remains in schema setup.
      createdAt: date("created_at").default(new Date(0)),
    });

    type TestInput = CreateInput<typeof testTable>;

    // This should compile - has all required fields
    const valid1: TestInput = {
      name: "test",
      email: "test@example.com",
    };

    // This should compile - has required + optional
    const valid2: TestInput = {
      name: "test",
      email: "test@example.com",
      active: false,
    };

    expect(valid1.name).toBe("test");
    expect(valid2.email).toBe("test@example.com");
  });

  test("column builder methods should maintain metadata", () => {
    const col1 = string("test");
    const col2 = col1.notNull();
    const col3 = col2.unique();
    const col4 = col3.default("default");

    expect(col1.meta.notNull).toBe(false);
    expect(col2.meta.notNull).toBe(true);
    expect(col3.meta.unique).toBe(true);
    expect(col4.meta.hasDefault).toBe(true);
  });

  test("chained methods should preserve all metadata", () => {
    const col = string("email").notNull().unique();

    expect(col.meta.notNull).toBe(true);
    expect(col.meta.unique).toBe(true);
    expect(col.meta.primaryKey).toBe(false);
    expect(col.meta.hasDefault).toBe(false);
  });
});

describe("Table - relations with custom primary key", () => {
  const accountsTable = new Table("test_accounts", {
    accountId: number("account_id").primaryKey(),
    name: string("name").notNull(),
  });

  const messagesTable = new Table("test_messages", {
    messageId: number("message_id").primaryKey(),
    accountId: number("account_id").notNull(),
    body: string("body").notNull(),
  });

  const customOrm = new Orm({
    url: ":memory:",
    tables: {
      accounts: accountsTable,
      messages: messagesTable,
    },
    relations: {
      accounts: {
        messages: many("accountId", () => messagesTable),
      },
      messages: {
        account: one("accountId", () => accountsTable),
      },
    },
  });

  beforeAll(async () => {
    await customOrm.sql`DROP TABLE IF EXISTS test_messages`;
    await customOrm.sql`DROP TABLE IF EXISTS test_accounts`;

    await customOrm.sql`
      CREATE TABLE test_accounts (
        account_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `;

    await customOrm.sql`
      CREATE TABLE test_messages (
        message_id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES test_accounts(account_id)
      )
    `;

    await customOrm.sql`
      INSERT INTO test_accounts (name)
      VALUES ('Acme')
    `;

    await customOrm.sql`
      INSERT INTO test_messages (account_id, body)
      VALUES (1, 'One'), (1, 'Two')
    `;
  });

  afterAll(async () => {
    await customOrm.sql`DROP TABLE IF EXISTS test_messages`;
    await customOrm.sql`DROP TABLE IF EXISTS test_accounts`;
    customOrm.close();
  });

  test("include should use custom primary key for one()", async () => {
    const message = await customOrm.tables.messages.findFirst({
      include: { account: true },
    });

    expect(message?.account).toBeDefined();
    expect(message?.account?.name).toBe("Acme");
  });

  test("include should use custom primary key for many()", async () => {
    const account = await customOrm.tables.accounts.findFirst({
      include: { messages: true },
    });

    expect(account?.messages).toBeDefined();
    expect(account?.messages.length).toBe(2);
  });
});

afterAll(async () => {
  await orm.sql`DROP TABLE IF EXISTS test_posts`;
  await orm.sql`DROP TABLE IF EXISTS test_users`;
  orm.close();
});

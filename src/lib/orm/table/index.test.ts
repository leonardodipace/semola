import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { err, ok } from "../../errors/index.js";
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
  // Static value for type metadata and DDL default generation.
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
  // Helper to reset test data to known state
  const resetTestData = async () => {
    await orm.sql`DELETE FROM test_posts`;
    await orm.sql`DELETE FROM test_users`;
    await orm.sql`DELETE FROM sqlite_sequence WHERE name='test_users'`;
    await orm.sql`DELETE FROM sqlite_sequence WHERE name='test_posts'`;

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
  };

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

    // Insert initial test data
    await resetTestData();
  });

  beforeEach(async () => {
    // Reset to known state before each test
    await resetTestData();
  });

  test("should return all rows when no where clause is provided", async () => {
    const [error, users] = await orm.tables.users.findMany();
    expect(error).toBeNull();
    expect(users?.length).toBe(4);
  });

  test("should filter by single condition", async () => {
    const [error, users] = await orm.tables.users.findMany({
      where: { name: "Alice" },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(1);
    expect(users?.[0]?.name).toBe("Alice");
    expect(users?.[0]?.email).toBe("alice@example.com");
  });

  test("should filter by multiple conditions (AND)", async () => {
    const [error, users] = await orm.tables.users.findMany({
      where: { name: "Bob", active: false },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(1);
    expect(users?.[0]?.name).toBe("Bob");
    expect(users?.[0]?.active).toBe(false);
  });

  test("should filter by boolean value", async () => {
    const [error1, activeUsers] = await orm.tables.users.findMany({
      where: { active: true },
    });
    expect(error1).toBeNull();
    expect(activeUsers?.length).toBe(2);
    expect(activeUsers?.every((u) => u.active)).toBe(true);

    const [error2, inactiveUsers] = await orm.tables.users.findMany({
      where: { active: false },
    });
    expect(error2).toBeNull();
    expect(inactiveUsers?.length).toBe(2);
    expect(inactiveUsers?.every((u) => !u.active)).toBe(true);
  });

  test("should return empty array when no matches found", async () => {
    const [error, users] = await orm.tables.users.findMany({
      where: { name: "NonExistent" },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(0);
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
      ":memory:",
    );

    const [error1, nullNameRows] = await nullableClient.findMany({
      where: { name: null },
    });
    expect(error1).toBeNull();
    expect(nullNameRows?.length).toBe(1);
    expect(nullNameRows?.[0]?.value).toBe(200);

    const [error2, nullValueRows] = await nullableClient.findMany({
      where: { value: null },
    });
    expect(error2).toBeNull();
    expect(nullValueRows?.length).toBe(1);
    expect(nullValueRows?.[0]?.name).toBe("another");

    // Cleanup
    await orm.sql`DROP TABLE IF EXISTS test_nullable`;
  });

  test("should prevent SQL injection in string values", async () => {
    const maliciousName = "Alice'; DROP TABLE test_users; --";

    // This should safely escape the value, not execute the SQL injection
    const [error1, users] = await orm.tables.users.findMany({
      where: { name: maliciousName },
    });

    // Should return no results (or 0 if the malicious string doesn't match any real data)
    expect(error1).toBeNull();
    expect(users?.length).toBe(0);

    // Verify table still exists by querying it
    const [error2, allUsers] = await orm.tables.users.findMany();
    expect(error2).toBeNull();
    expect(allUsers?.length).toBe(4); // Original 4 users should still be there
  });

  test("should throw error for invalid column names", async () => {
    const [error, users] = await orm.tables.users.findMany({
      // @ts-expect-error - invalidColumn doesn't exist on users table
      where: { invalidColumn: "value" },
    });
    expect(error).not.toBeNull();
    if (error && typeof error === "object" && "message" in error) {
      expect(error.message).toContain("Invalid column: invalidColumn");
    }
    expect(users).toBeNull();
  });

  test("should filter with equals operator", async () => {
    const [error1, users] = await orm.tables.users.findMany({
      where: { name: { equals: "Alice" } },
    });
    expect(error1).toBeNull();
    expect(users?.length).toBe(1);
    expect(users?.[0]?.name).toBe("Alice");

    // Test with boolean
    const [error2, activeUsers] = await orm.tables.users.findMany({
      where: { active: { equals: true } },
    });
    expect(error2).toBeNull();
    expect(activeUsers?.length).toBe(2);
  });

  test("should filter with contains operator (case insensitive)", async () => {
    const [error1, users] = await orm.tables.users.findMany({
      where: { name: { contains: "ali" } },
    });
    expect(error1).toBeNull();
    expect(users?.length).toBe(1);
    expect(users?.[0]?.name).toBe("Alice");

    // Test case insensitivity
    const [error2, usersUpper] = await orm.tables.users.findMany({
      where: { name: { contains: "ALI" } },
    });
    expect(error2).toBeNull();
    expect(usersUpper?.length).toBe(1);
  });

  test("should filter with gt operator", async () => {
    // beforeEach ensures clean state with IDs 1-4
    const [error, users] = await orm.tables.users.findMany({
      where: { id: { gt: 1 } },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(3);
    expect(users?.every((u) => u.id > 1)).toBe(true);
  });

  test("should filter with gte operator", async () => {
    const [error, users] = await orm.tables.users.findMany({
      where: { id: { gte: 2 } },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(3);
    expect(users?.every((u) => u.id >= 2)).toBe(true);
  });

  test("should filter with lt operator", async () => {
    const [error, users] = await orm.tables.users.findMany({
      where: { id: { lt: 3 } },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(2);
    expect(users?.every((u) => u.id < 3)).toBe(true);
  });

  test("should filter with lte operator", async () => {
    const [error, users] = await orm.tables.users.findMany({
      where: { id: { lte: 2 } },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(2);
    expect(users?.every((u) => u.id <= 2)).toBe(true);
  });

  test("should filter with multiple operators combined", async () => {
    // ID between 1 and 2 (inclusive)
    const [error, users] = await orm.tables.users.findMany({
      where: { id: { gte: 1, lte: 2 } },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(2);
    expect(users?.every((u) => u.id >= 1 && u.id <= 2)).toBe(true);
  });

  test("should combine direct values and operators", async () => {
    // beforeEach ensures clean state with 4 users (IDs 1-4)
    // Alice and Charlie are active (IDs 1, 3)
    const [error, users] = await orm.tables.users.findMany({
      where: {
        active: true,
        id: { gte: 2 },
      },
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(1);
    expect(users?.every((u) => u.active && u.id >= 2)).toBe(true);
  });

  test("findFirst should return first matching row", async () => {
    const [error, user] = await orm.tables.users.findFirst({
      where: { active: true },
    });
    expect(error).toBeNull();
    expect(user).not.toBeNull();
    expect(user?.active).toBe(true);
  });

  test("findFirst should return null when no matches found", async () => {
    const [error, user] = await orm.tables.users.findFirst({
      where: { name: "NonExistent" },
    });
    expect(error).toBeNull();
    expect(user).toBeNull();
  });

  test("findFirst without where should return first row", async () => {
    const [error, user] = await orm.tables.users.findFirst();
    expect(error).toBeNull();
    expect(user).not.toBeNull();
  });

  test("findUnique should return row by primary key", async () => {
    const [error, user] = await orm.tables.users.findUnique({
      where: { id: 1 },
    });
    expect(error).toBeNull();
    expect(user).not.toBeNull();
    expect(user?.id).toBe(1);
  });

  test("findUnique should return row by unique field", async () => {
    const [error, user] = await orm.tables.users.findUnique({
      where: { email: "alice@example.com" },
    });
    expect(error).toBeNull();
    expect(user).not.toBeNull();
    expect(user?.email).toBe("alice@example.com");
  });

  test("findUnique should return null when not found", async () => {
    const [error, user] = await orm.tables.users.findUnique({
      where: { id: 999 },
    });
    expect(error).toBeNull();
    expect(user).toBeNull();
  });

  test("findUnique should throw error for non-unique column", async () => {
    const [error, user] = await orm.tables.users.findUnique({
      where: { active: { equals: true } },
    });
    expect(error).not.toBeNull();
    if (error && typeof error === "object" && "message" in error) {
      expect(error.message).toContain(
        "findUnique requires a unique selector on a primary key or unique column",
      );
    }
    expect(user).toBeNull();
  });

  test("findUnique should reject composite unique lookups with multiple columns", async () => {
    const [error, user] = await orm.tables.users.findUnique({
      where: { id: 1, email: "alice@example.com" },
    });
    expect(error).not.toBeNull();
    if (error && typeof error === "object" && "message" in error) {
      expect(error.message).toContain(
        "findUnique requires a unique selector with exactly one column",
      );
    }
    expect(user).toBeNull();
  });

  test("findMany should throw error for unknown include relation", async () => {
    const [error, users] = await orm.tables.users.findMany({
      include: { unknownRelation: true },
    });

    expect(error).not.toBeNull();
    if (error && typeof error === "object" && "message" in error) {
      expect(error.message).toContain("Unknown relation in include");
    }
    expect(users).toBeNull();
  });

  test("findMany with take should limit results", async () => {
    const [error, users] = await orm.tables.users.findMany({
      take: 2,
    });
    expect(error).toBeNull();
    expect(users?.length).toBe(2);
  });

  test("findMany with skip should skip results", async () => {
    const [error1, allUsers] = await orm.tables.users.findMany();
    expect(error1).toBeNull();
    const [error2, skipped] = await orm.tables.users.findMany({
      skip: 2,
    });
    expect(error2).toBeNull();
    expect(skipped?.length).toBe(allUsers?.length ? allUsers.length - 2 : 0);
    expect(skipped?.[0]?.id).toBe(allUsers?.[2]?.id);
  });

  test("findMany with take and skip should paginate", async () => {
    const [error1, page1] = await orm.tables.users.findMany({
      take: 2,
      skip: 0,
    });
    expect(error1).toBeNull();
    const [error2, page2] = await orm.tables.users.findMany({
      take: 2,
      skip: 2,
    });
    expect(error2).toBeNull();
    expect(page1?.length).toBe(2);
    expect(page2?.length).toBe(2);
    expect(page1?.[0]?.id).not.toBe(page2?.[0]?.id);
  });

  test("findMany with where and pagination should work together", async () => {
    const [error, users] = await orm.tables.users.findMany({
      where: { active: true },
      take: 1,
    });
    expect(error).toBeNull();
    expect(users?.length).toBeLessThanOrEqual(1);
    expect(users?.every((u) => u.active)).toBe(true);
  });

  test("findMany with include should load one() relations", async () => {
    const [error, posts] = await orm.tables.posts.findMany({
      include: { author: true },
    });
    expect(error).toBeNull();
    expect(posts?.length).toBeGreaterThan(0);

    const [post] = posts || [];
    expect(post?.author).toBeDefined();
    expect(post?.author?.name).toBeDefined();
    expect(post?.author?.email).toBeDefined();
  });

  test("findFirst with include should load one() relations", async () => {
    const [error, post] = await orm.tables.posts.findFirst({
      include: { author: true },
    });
    expect(error).toBeNull();
    if (post) {
      expect(post.author).toBeDefined();
      expect(post.author?.name).toBeDefined();
    }
  });

  test("findUnique with include should load one() relations", async () => {
    const [error, post] = await orm.tables.posts.findUnique({
      where: { id: 1 },
      include: { author: true },
    });
    expect(error).toBeNull();
    if (post) {
      expect(post.author).toBeDefined();
      expect(post.author?.name).toBe("Alice");
    }
  });

  test("findMany with include should load many() relations", async () => {
    const [error, users] = await orm.tables.users.findMany({
      include: { posts: true },
    });
    expect(error).toBeNull();
    expect(users?.length).toBeGreaterThan(0);
    const alice = users?.find((u) => u.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice?.posts).toBeDefined();
    expect(Array.isArray(alice?.posts)).toBe(true);
    expect(alice?.posts.length).toBe(2); // Alice has 2 posts
    expect(alice?.posts.every((p) => p.authorId === alice.id)).toBe(true);
  });

  test("findFirst with include should load many() relations", async () => {
    const [error, user] = await orm.tables.users.findFirst({
      where: { name: "Alice" },
      include: { posts: true },
    });
    expect(error).toBeNull();
    if (user) {
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBe(2);
    }
  });

  test("findUnique with include should load many() relations", async () => {
    const [error, user] = await orm.tables.users.findUnique({
      where: { id: 1 },
      include: { posts: true },
    });
    expect(error).toBeNull();
    if (user) {
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBe(2);
    }
  });

  test("many() relations should return empty array when no related records", async () => {
    const [error, user] = await orm.tables.users.findUnique({
      where: { id: 4 }, // Diana has no posts
      include: { posts: true },
    });
    expect(error).toBeNull();
    if (user) {
      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts.length).toBe(0);
    }
  });
});
describe("Table - create method", () => {
  test("should create a new user with required fields", async () => {
    const [error, newUser] = await orm.tables.users.create({
      name: "Eve",
      email: "eve@example.com",
    });

    expect(error).toBeNull();
    expect(newUser?.id).toBeDefined();
    expect(newUser?.name).toBe("Eve");
    expect(newUser?.email).toBe("eve@example.com");
    expect(newUser?.active).toBe(true); // Default value
  });

  test("should create a user with optional fields set", async () => {
    const [error, newUser] = await orm.tables.users.create({
      name: "Frank",
      email: "frank@example.com",
      active: false,
    });

    expect(error).toBeNull();
    expect(newUser?.name).toBe("Frank");
    expect(newUser?.email).toBe("frank@example.com");
    expect(newUser?.active).toBe(false);
  });

  test("should throw error when required field is missing", async () => {
    // @ts-expect-error - missing required fields
    const [error, newUser] = await orm.tables.users.create({
      email: "invalid@example.com",
    });

    expect(error).not.toBeNull();
    expect(newUser).toBeNull();
  });
});

describe("Table - update method", () => {
  test("should update a user by id", async () => {
    const [error, updated] = await orm.tables.users.update({
      where: { id: 1 },
      data: { name: "Alice Updated" },
    });

    expect(error).toBeNull();
    expect(updated?.name).toBe("Alice Updated");
    expect(updated?.id).toBe(1);
  });

  test("should update multiple fields", async () => {
    const [error, updated] = await orm.tables.users.update({
      where: { id: 2 },
      data: { name: "Bob Updated", active: true },
    });

    expect(error).toBeNull();
    expect(updated?.name).toBe("Bob Updated");
    expect(updated?.active).toBe(true);
    expect(updated?.id).toBe(2);
  });

  test("should reject update with non-unique selector", async () => {
    const [error, updated] = await orm.tables.users.update({
      where: { active: false },
      data: { active: true },
    });

    expect(error).not.toBeNull();
    if (error && typeof error === "object" && "message" in error) {
      expect(error.message).toContain(
        "update requires a unique selector on a primary key or unique column",
      );
    }
    expect(updated).toBeNull();
  });

  test("should reject update with multi-field where selector", async () => {
    const [error, updated] = await orm.tables.users.update({
      where: { id: 1, email: "alice@example.com" },
      data: { name: "Alice Changed" },
    });

    expect(error).not.toBeNull();
    if (error && typeof error === "object" && "message" in error) {
      expect(error.message).toContain(
        "update requires a unique selector with exactly one column",
      );
    }
    expect(updated).toBeNull();
  });

  test("should throw error when where clause is missing", async () => {
    // @ts-expect-error - missing where clause
    const [error, updated] = await orm.tables.users.update({
      data: { name: "Test" },
    });

    expect(error).not.toBeNull();
    expect(updated).toBeNull();
  });
});

describe("Table - delete method", () => {
  test("should delete a user by id", async () => {
    // First create a user to delete
    const [error1, newUser] = await orm.tables.users.create({
      name: "ToDelete",
      email: "todelete@example.com",
    });
    expect(error1).toBeNull();

    const [error2, deleted] = await orm.tables.users.delete({
      where: { id: newUser?.id },
    });

    expect(error2).toBeNull();
    expect(deleted?.id).toBe(newUser?.id);
    expect(deleted?.name).toBe("ToDelete");

    // Verify it's deleted
    const [error3, found] = await orm.tables.users.findFirst({
      where: { id: newUser?.id },
    });
    expect(error3).toBeNull();
    expect(found).toBeNull();
  });

  test("should reject delete with non-unique selector", async () => {
    // Create two users to delete
    const [error1] = await orm.tables.users.create({
      name: "Delete1",
      email: "delete1@example.com",
      active: false,
    });
    expect(error1).toBeNull();

    const [error2] = await orm.tables.users.create({
      name: "Delete2",
      email: "delete2@example.com",
      active: false,
    });
    expect(error2).toBeNull();

    const [error3, deleted] = await orm.tables.users.delete({
      where: { name: { in: ["Delete1", "Delete2"] } },
    });

    expect(error3).not.toBeNull();
    if (error3 && typeof error3 === "object" && "message" in error3) {
      expect(error3.message).toContain(
        "delete requires a unique selector on a primary key or unique column",
      );
    }
    expect(deleted).toBeNull();

    await orm.tables.users.delete({ where: { email: "delete1@example.com" } });
    await orm.tables.users.delete({ where: { email: "delete2@example.com" } });
  });

  test("should reject delete with multi-field where selector", async () => {
    const [error, deleted] = await orm.tables.users.delete({
      where: { id: 1, email: "alice@example.com" },
    });

    expect(error).not.toBeNull();
    if (error && typeof error === "object" && "message" in error) {
      expect(error.message).toContain(
        "delete requires a unique selector with exactly one column",
      );
    }
    expect(deleted).toBeNull();
  });

  test("should throw error when where clause is missing", async () => {
    // @ts-expect-error - missing where clause
    const [error, deleted] = await orm.tables.users.delete({});
    expect(error).not.toBeNull();
    expect(deleted).toBeNull();
  });
});

describe("Table - CreateInput type validation", () => {
  test("should infer required fields correctly", () => {
    const testTable = new Table("test", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
      active: boolean("active").default(true),
      // Static value for type metadata and DDL default generation.
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
    await customOrm.close();
  });

  test("include should use custom primary key for one()", async () => {
    const [error, message] = await customOrm.tables.messages.findFirst({
      include: { account: true },
    });

    expect(error).toBeNull();
    expect(message?.account).toBeDefined();
    expect(message?.account?.name).toBe("Acme");
  });

  test("include should use custom primary key for many()", async () => {
    const [error, account] = await customOrm.tables.accounts.findFirst({
      include: { messages: true },
    });

    expect(error).toBeNull();
    expect(account?.messages).toBeDefined();
    expect(account?.messages.length).toBe(2);
  });
});

describe("Table - relations with date primary keys", () => {
  const eventsTable = new Table("test_events", {
    occurredAt: date("occurred_at").primaryKey(),
    name: string("name").notNull(),
  });

  const logsTable = new Table("test_event_logs", {
    id: number("id").primaryKey(),
    occurredAt: date("occurred_at").notNull(),
    message: string("message").notNull(),
  });

  const dateRelationOrm = new Orm({
    url: ":memory:",
    tables: {
      events: eventsTable,
      logs: logsTable,
    },
    relations: {
      events: {
        logs: many("occurredAt", () => logsTable),
      },
      logs: {
        event: one("occurredAt", () => eventsTable),
      },
    },
  });

  const occurredAt = new Date("2026-02-20T10:20:30.000Z");

  beforeAll(async () => {
    await dateRelationOrm.sql`DROP TABLE IF EXISTS test_event_logs`;
    await dateRelationOrm.sql`DROP TABLE IF EXISTS test_events`;

    await dateRelationOrm.sql`
      CREATE TABLE test_events (
        occurred_at INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    await dateRelationOrm.sql`
      CREATE TABLE test_event_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at INTEGER NOT NULL,
        message TEXT NOT NULL
      )
    `;

    await dateRelationOrm.tables.events.create({
      occurredAt,
      name: "Deploy",
    });

    await dateRelationOrm.tables.logs.create({
      occurredAt,
      message: "Log 1",
    });

    await dateRelationOrm.tables.logs.create({
      occurredAt,
      message: "Log 2",
    });
  });

  afterAll(async () => {
    await dateRelationOrm.sql`DROP TABLE IF EXISTS test_event_logs`;
    await dateRelationOrm.sql`DROP TABLE IF EXISTS test_events`;
    await dateRelationOrm.close();
  });

  test("include should load one() relation when fk/pk are dates", async () => {
    const [error, log] = await dateRelationOrm.tables.logs.findFirst({
      include: { event: true },
    });

    expect(error).toBeNull();
    expect(log?.event).toBeDefined();
    expect(log?.event?.name).toBe("Deploy");
    expect(log?.event?.occurredAt).toBeInstanceOf(Date);
  });

  test("include should load many() relation when fk/pk are dates", async () => {
    const [error, event] = await dateRelationOrm.tables.events.findFirst({
      include: { logs: true },
    });

    expect(error).toBeNull();
    expect(event?.logs).toBeDefined();
    expect(event?.logs.length).toBe(2);
    expect(event?.logs[0]?.occurredAt).toBeInstanceOf(Date);
  });
});

describe("Table - MySQL dialect compatibility", () => {
  // These tests use SQLite with dialect="mysql" to verify that MySQL's lack of RETURNING support
  // is handled correctly by using SELECT-after-UPDATE and SELECT-before-DELETE patterns.
  // The code detects when it's running on SQLite vs actual MySQL and uses appropriate syntax.

  test("update works correctly with MySQL dialect (SELECT after UPDATE)", async () => {
    // Create ORM with MySQL dialect to trigger SELECT-after-UPDATE flow
    const mysqlOrm = new Orm({
      url: ":memory:",
      dialect: "mysql",
      tables: {
        users: usersTable,
        posts: postsTable,
      },
    });

    await mysqlOrm.sql`DROP TABLE IF EXISTS test_users`;
    await mysqlOrm.sql`DROP TABLE IF EXISTS test_posts`;

    await mysqlOrm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at TEXT
      )
    `;

    // Insert test user using raw SQL (MySQL buildInsert doesn't include RETURNING)
    await mysqlOrm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES ('MySQL Test User', 'mysql@example.com', 1)
    `;

    const userId = 1; // Known ID from first insert

    // Update using MySQL dialect (triggers SELECT after UPDATE)
    const [updateError, updated] = await mysqlOrm.tables.users.update({
      where: { id: userId },
      data: { name: "Updated Name" },
    });

    expect(updateError).toBeNull();
    expect(updated).toBeDefined();
    expect(updated?.name).toBe("Updated Name");
    expect(updated?.id).toBe(userId);
    expect(updated?.email).toBe("mysql@example.com");

    // Verify the update actually persisted
    const [findError, found] = await mysqlOrm.tables.users.findFirst({
      where: { id: userId },
    });
    expect(findError).toBeNull();
    expect(found?.name).toBe("Updated Name");

    await mysqlOrm.close();
  });

  test("create works correctly with MySQL dialect (reselect inserted row)", async () => {
    const mysqlOrm = new Orm({
      url: ":memory:",
      dialect: "mysql",
      tables: { users: usersTable },
    });

    await mysqlOrm.sql`DROP TABLE IF EXISTS test_users`;
    await mysqlOrm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at TEXT
      )
    `;

    const [error, created] = await mysqlOrm.tables.users.create({
      name: "Created via mysql dialect",
      email: "created-mysql@test.com",
      active: true,
    });

    expect(error).toBeNull();
    expect(created?.id).toBe(1);
    expect(created?.name).toBe("Created via mysql dialect");
    expect(created?.email).toBe("created-mysql@test.com");

    await mysqlOrm.close();
  });

  test("update with multiple fields works correctly with MySQL dialect", async () => {
    const mysqlOrm = new Orm({
      url: ":memory:",
      dialect: "mysql",
      tables: { users: usersTable },
    });

    await mysqlOrm.sql`DROP TABLE IF EXISTS test_users`;
    await mysqlOrm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at TEXT
      )
    `;

    // Insert test user using raw SQL
    await mysqlOrm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES ('Test', 'test@test.com', 1)
    `;

    const userId = 1;

    // Update multiple fields
    const [error, updated] = await mysqlOrm.tables.users.update({
      where: { id: userId },
      data: {
        name: "New Name",
        email: "new@test.com",
        active: false,
      },
    });

    expect(error).toBeNull();
    expect(updated?.name).toBe("New Name");
    expect(updated?.email).toBe("new@test.com");
    expect(updated?.active).toBe(false);

    await mysqlOrm.close();
  });

  test("delete works correctly with MySQL dialect (SELECT before DELETE)", async () => {
    const mysqlOrm = new Orm({
      url: ":memory:",
      dialect: "mysql",
      tables: {
        users: usersTable,
        posts: postsTable,
      },
    });

    await mysqlOrm.sql`DROP TABLE IF EXISTS test_users`;
    await mysqlOrm.sql`DROP TABLE IF EXISTS test_posts`;

    await mysqlOrm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at TEXT
      )
    `;

    // Insert test user using raw SQL
    await mysqlOrm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES ('Delete Test', 'delete@example.com', 1)
    `;

    const userId = 1;

    // Delete using MySQL dialect (triggers SELECT before DELETE)
    const [deleteError, deleted] = await mysqlOrm.tables.users.delete({
      where: { id: userId },
    });

    expect(deleteError).toBeNull();
    expect(deleted).toBeDefined();
    expect(deleted?.id).toBe(userId);
    expect(deleted?.name).toBe("Delete Test");
    expect(deleted?.email).toBe("delete@example.com");

    // Verify the row was actually deleted
    const [findError, found] = await mysqlOrm.tables.users.findFirst({
      where: { id: userId },
    });
    expect(findError).toBeNull();
    expect(found).toBeNull();

    await mysqlOrm.close();
  });

  test("delete using unique selector works with MySQL dialect", async () => {
    const mysqlOrm = new Orm({
      url: ":memory:",
      dialect: "mysql",
      tables: { users: usersTable },
    });

    await mysqlOrm.sql`DROP TABLE IF EXISTS test_users`;
    await mysqlOrm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at TEXT
      )
    `;

    await mysqlOrm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES ('User1', 'user1@test.com', 0)
    `;

    // Delete using unique non-primary where clause
    const [error, deleted] = await mysqlOrm.tables.users.delete({
      where: {
        email: "user1@test.com",
      },
    });

    expect(error).toBeNull();
    expect(deleted?.name).toBe("User1");
    expect(deleted?.email).toBe("user1@test.com");
    expect(deleted?.active).toBe(false);

    await mysqlOrm.close();
  });

  test("dialect property correctly identifies MySQL", async () => {
    const sqliteOrm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: { users: usersTable },
    });

    const postgresOrm = new Orm({
      url: "postgres://localhost/test",
      dialect: "postgres",
      tables: { users: usersTable },
    });

    const mysqlOrm = new Orm({
      url: "mysql://localhost/test",
      dialect: "mysql",
      tables: { users: usersTable },
    });

    // Verify dialects are properly detected
    expect(sqliteOrm.getDialectName()).toBe("sqlite");
    expect(postgresOrm.getDialectName()).toBe("postgres");
    expect(mysqlOrm.getDialectName()).toBe("mysql");

    await sqliteOrm.close();
    await postgresOrm.close();
    await mysqlOrm.close();
  });

  test("MySQL update returns correct data when row matches where clause", async () => {
    const mysqlOrm = new Orm({
      url: ":memory:",
      dialect: "mysql",
      tables: { users: usersTable },
    });

    await mysqlOrm.sql`DROP TABLE IF EXISTS test_users`;
    await mysqlOrm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at TEXT
      )
    `;

    // Insert multiple users
    await mysqlOrm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES
        ('Alice', 'alice@test.com', 1),
        ('Bob', 'bob@test.com', 0)
    `;

    // Update using where clause
    const [error, updated] = await mysqlOrm.tables.users.update({
      where: { email: "bob@test.com" },
      data: { active: true },
    });

    expect(error).toBeNull();
    expect(updated?.name).toBe("Bob");
    expect(updated?.active).toBe(true);

    await mysqlOrm.close();
  });

  test("MySQL update reselect works when filtered unique field changes", async () => {
    const mysqlOrm = new Orm({
      url: ":memory:",
      dialect: "mysql",
      tables: { users: usersTable },
    });

    await mysqlOrm.sql`DROP TABLE IF EXISTS test_users`;
    await mysqlOrm.sql`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at TEXT
      )
    `;

    await mysqlOrm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES ('Bob', 'before-change@test.com', 1)
    `;

    const [error, updated] = await mysqlOrm.tables.users.update({
      where: { email: "before-change@test.com" },
      data: { email: "after-change@test.com", name: "Bob Updated" },
    });

    expect(error).toBeNull();
    expect(updated?.name).toBe("Bob Updated");
    expect(updated?.email).toBe("after-change@test.com");

    const [findError, found] = await mysqlOrm.tables.users.findUnique({
      where: { email: "after-change@test.com" },
    });
    expect(findError).toBeNull();
    expect(found?.name).toBe("Bob Updated");

    await mysqlOrm.close();
  });
});

describe("Table - date normalization", () => {
  const dateTable = new Table("test_dates", {
    id: number("id").primaryKey(),
    happenedAt: date("happened_at").notNull(),
  });

  const dateOrm = new Orm({
    url: ":memory:",
    tables: { dates: dateTable },
  });

  beforeAll(async () => {
    await dateOrm.sql`DROP TABLE IF EXISTS test_dates`;
    await dateOrm.sql`
      CREATE TABLE test_dates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        happened_at INTEGER NOT NULL
      )
    `;
  });

  afterAll(async () => {
    await dateOrm.sql`DROP TABLE IF EXISTS test_dates`;
    await dateOrm.close();
  });

  test("should normalize sqlite date writes and reads as Date", async () => {
    const happenedAt = new Date("2026-01-01T10:30:00.000Z");

    const [createError, created] = await dateOrm.tables.dates.create({
      happenedAt,
    });

    expect(createError).toBeNull();
    expect(created?.happenedAt).toBeInstanceOf(Date);
    expect(created?.happenedAt.getTime()).toBe(happenedAt.getTime());

    const [findError, found] = await dateOrm.tables.dates.findUnique({
      where: { id: created?.id },
    });

    expect(findError).toBeNull();
    expect(found?.happenedAt).toBeInstanceOf(Date);
    expect(found?.happenedAt.getTime()).toBe(happenedAt.getTime());

    const [whereError, byDate] = await dateOrm.tables.dates.findMany({
      where: { happenedAt },
    });

    expect(whereError).toBeNull();
    expect(byDate?.length).toBe(1);
    expect(byDate?.[0]?.id).toBe(created?.id);
  });
});

describe("Table - count method", () => {
  const resetCountData = async () => {
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
  };

  beforeEach(async () => {
    await resetCountData();
  });

  test("should count all rows without where clause", async () => {
    const [error, count] = await orm.tables.users.count();

    expect(error).toBeNull();
    expect(count).toBe(4);
  });

  test("should count filtered rows with where clause", async () => {
    const [error, count] = await orm.tables.users.count({
      where: { active: true },
    });

    expect(error).toBeNull();
    expect(count).toBe(2);
  });

  test("should return 0 when no rows match", async () => {
    const [error, count] = await orm.tables.users.count({
      where: { name: "NonExistent" },
    });

    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  test("should count with multiple combined filters", async () => {
    const [error, count] = await orm.tables.users.count({
      where: { active: true, name: { contains: "Ali" } },
    });

    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  test("should count with in filter", async () => {
    const [error, count] = await orm.tables.users.count({
      where: { id: { in: [1, 2, 999] } },
    });

    expect(error).toBeNull();
    expect(count).toBe(2);
  });
});

describe("Table - createMany method", () => {
  beforeEach(async () => {
    await orm.sql`DELETE FROM test_users`;
    await orm.sql`DELETE FROM sqlite_sequence WHERE name='test_users'`;
  });

  test("should return empty array for empty input", async () => {
    const [error, result] = await orm.tables.users.createMany([]);

    expect(error).toBeNull();
    expect(result).toEqual([]);
  });

  test("should create multiple rows and return them", async () => {
    const [error, result] = await orm.tables.users.createMany([
      { name: "User1", email: "user1@example.com" },
      { name: "User2", email: "user2@example.com" },
      { name: "User3", email: "user3@example.com" },
    ]);

    expect(error).toBeNull();
    expect(result?.length).toBe(3);
    expect(result?.[0]?.name).toBe("User1");
    expect(result?.[1]?.name).toBe("User2");
    expect(result?.[2]?.name).toBe("User3");

    const [countError, count] = await orm.tables.users.count();
    expect(countError).toBeNull();
    expect(count).toBe(3);
  });

  test("should fail fast on invalid data", async () => {
    const [error, result] = await orm.tables.users.createMany([
      { name: "Valid", email: "valid@example.com" },
      // @ts-expect-error - missing required field
      { email: "invalid@example.com" },
    ]);

    expect(error).not.toBeNull();
    expect(result).toBeNull();

    const [countError, count] = await orm.tables.users.count();
    expect(countError).toBeNull();
    expect(count).toBe(1);
  });

  test("should handle single item array", async () => {
    const [error, result] = await orm.tables.users.createMany([
      { name: "Single", email: "single@example.com" },
    ]);

    expect(error).toBeNull();
    expect(result?.length).toBe(1);
    expect(result?.[0]?.name).toBe("Single");
  });

  test("should preserve all field values including defaults", async () => {
    const [error, result] = await orm.tables.users.createMany([
      { name: "WithDefaults", email: "defaults@example.com", active: false },
    ]);

    expect(error).toBeNull();
    expect(result?.[0]?.active).toBe(false);
    expect(result?.[0]?.createdAt).toBeInstanceOf(Date);
  });
});

describe("Table - upsert method", () => {
  beforeEach(async () => {
    await orm.sql`DELETE FROM test_users`;
    await orm.sql`DELETE FROM sqlite_sequence WHERE name='test_users'`;

    await orm.sql`
      INSERT INTO test_users (name, email, active)
      VALUES ('Alice', 'alice@example.com', true)
    `;
  });

  test("should create new row when not found by unique column", async () => {
    const [error, result] = await orm.tables.users.upsert({
      where: { email: "new@example.com" },
      create: { name: "New User", email: "new@example.com" },
      update: { name: "Updated Name" },
    });

    expect(error).toBeNull();
    expect(result?.name).toBe("New User");
    expect(result?.email).toBe("new@example.com");

    const [countError, count] = await orm.tables.users.count();
    expect(countError).toBeNull();
    expect(count).toBe(2);
  });

  test("should update existing row when found by pk", async () => {
    const [error, result] = await orm.tables.users.upsert({
      where: { id: 1 },
      create: { name: "ShouldNotCreate", email: "should@example.com" },
      update: { name: "Alice Updated" },
    });

    expect(error).toBeNull();
    expect(result?.id).toBe(1);
    expect(result?.name).toBe("Alice Updated");
    expect(result?.email).toBe("alice@example.com");

    const [countError, count] = await orm.tables.users.count();
    expect(countError).toBeNull();
    expect(count).toBe(1);
  });

  test("should update existing row when found by unique column", async () => {
    const [error, result] = await orm.tables.users.upsert({
      where: { email: "alice@example.com" },
      create: { name: "ShouldNotCreate", email: "alice@example.com" },
      update: { name: "Alice Updated Via Email", active: false },
    });

    expect(error).toBeNull();
    expect(result?.name).toBe("Alice Updated Via Email");
    expect(result?.active).toBe(false);
  });

  test("should error on non-unique where clause", async () => {
    const [error, result] = await orm.tables.users.upsert({
      where: { active: true },
      create: { name: "New", email: "new@example.com" },
      update: { name: "Updated" },
    });

    expect(error).not.toBeNull();
    expect(result).toBeNull();
  });

  test("should error on multi-column where clause", async () => {
    const [error, result] = await orm.tables.users.upsert({
      where: { id: 1, email: "alice@example.com" },
      create: { name: "New", email: "new@example.com" },
      update: { name: "Updated" },
    });

    expect(error).not.toBeNull();
    expect(result).toBeNull();
  });

  test("should update with partial data preserving other fields", async () => {
    const [error, result] = await orm.tables.users.upsert({
      where: { id: 1 },
      create: { name: "New", email: "new@example.com" },
      update: { active: false },
    });

    expect(error).toBeNull();
    expect(result?.name).toBe("Alice");
    expect(result?.email).toBe("alice@example.com");
    expect(result?.active).toBe(false);
  });

  test("should create with all fields set", async () => {
    const [error, result] = await orm.tables.users.upsert({
      where: { id: 999 },
      create: {
        name: "Complete",
        email: "complete@example.com",
        active: false,
      },
      update: { name: "ShouldNotUpdate" },
    });

    expect(error).toBeNull();
    expect(result?.name).toBe("Complete");
    expect(result?.email).toBe("complete@example.com");
    expect(result?.active).toBe(false);
  });
});

describe("Orm - transaction method", () => {
  beforeEach(async () => {
    await orm.sql`DELETE FROM test_users`;
    await orm.sql`DELETE FROM test_posts`;
    await orm.sql`DELETE FROM sqlite_sequence WHERE name='test_users'`;
    await orm.sql`DELETE FROM sqlite_sequence WHERE name='test_posts'`;
  });

  test("should commit successful transaction", async () => {
    const [error, result] = await orm.transaction(async (tx) => {
      const [err1, user] = await tx.tables.users.create({
        name: "TxUser",
        email: "tx@example.com",
      });
      if (err1) return err(err1.type, err1.message);

      const [err2, post] = await tx.tables.posts.create({
        title: "TxPost",
        content: "Content",
        authorId: user.id,
      });
      if (err2) return err(err2.type, err2.message);

      return ok({ user, post });
    });

    expect(error).toBeNull();
    expect(result?.user.name).toBe("TxUser");
    expect(result?.post.title).toBe("TxPost");

    const [userError, users] = await orm.tables.users.findMany();
    expect(userError).toBeNull();
    expect(users?.length).toBe(1);

    const [postError, posts] = await orm.tables.posts.findMany();
    expect(postError).toBeNull();
    expect(posts?.length).toBe(1);
  });

  test("should rollback when callback returns error", async () => {
    const [error, result] = await orm.transaction(async (tx) => {
      const [err1] = await tx.tables.users.create({
        name: "TxUser",
        email: "tx@example.com",
      });
      if (err1) return err(err1.type, err1.message);

      return err("CustomError", "Intentional rollback");
    });

    expect(error).not.toBeNull();
    expect(result).toBeNull();

    const [countError, count] = await orm.tables.users.count();
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });

  test("should rollback when operation fails", async () => {
    const [, existingUser] = await orm.tables.users.create({
      name: "Existing",
      email: "duplicate@example.com",
    });
    expect(existingUser).not.toBeNull();

    const [error, result] = await orm.transaction(async (tx) => {
      const [err1, user] = await tx.tables.users.create({
        name: "TxUser",
        email: "tx@example.com",
      });
      if (err1) return err(err1.type, err1.message);

      const [err2] = await tx.tables.users.create({
        name: "Duplicate",
        email: "duplicate@example.com",
      });

      if (err2) return err(err2.type, err2.message);

      return ok(user);
    });

    expect(error).not.toBeNull();
    expect(result).toBeNull();

    const [countError, count] = await orm.tables.users.count();
    expect(countError).toBeNull();
    expect(count).toBe(1);
  });

  test("should perform read operations in transaction", async () => {
    await orm.tables.users.create({
      name: "Existing",
      email: "existing@example.com",
    });

    const [error, result] = await orm.transaction(async (tx) => {
      const [err1, users] = await tx.tables.users.findMany();
      if (err1) return err(err1.type, err1.message);

      const [err2, count] = await tx.tables.users.count();
      if (err2) return err(err2.type, err2.message);

      return ok({ users, count });
    });

    expect(error).toBeNull();
    expect(result?.count).toBe(1);
    expect(result?.users[0]?.name).toBe("Existing");
  });

  test("should update existing rows in transaction", async () => {
    const [, user] = await orm.tables.users.create({
      name: "ToUpdate",
      email: "update@example.com",
    });
    if (!user) throw new Error("User should not be null");
    const userId = user.id;

    const [error, result] = await orm.transaction(async (tx) => {
      const [err1, updated] = await tx.tables.users.update({
        where: { id: userId },
        data: { name: "Updated" },
      });
      if (err1) return err(err1.type, err1.message);

      const [err2, found] = await tx.tables.users.findUnique({
        where: { id: userId },
      });
      if (err2) return err(err2.type, err2.message);

      return ok({ updated, found });
    });

    expect(error).toBeNull();
    expect(result?.updated.name).toBe("Updated");
    expect(result?.found?.name).toBe("Updated");

    const [, persisted] = await orm.tables.users.findUnique({
      where: { id: userId },
    });
    expect(persisted?.name).toBe("Updated");
  });

  test("should delete rows in transaction", async () => {
    const [, user] = await orm.tables.users.create({
      name: "ToDelete",
      email: "delete@example.com",
    });
    if (!user) throw new Error("User should not be null");
    const userId = user.id;

    const [error] = await orm.transaction(async (tx) => {
      const [err1] = await tx.tables.users.delete({ where: { id: userId } });
      if (err1) return err(err1.type, err1.message);

      const [err2, count] = await tx.tables.users.count();
      if (err2) return err(err2.type, err2.message);

      return ok(count);
    });

    expect(error).toBeNull();

    const [, count] = await orm.tables.users.count();
    expect(count).toBe(0);
  });

  test("should use upsert within transaction", async () => {
    const [error, result] = await orm.transaction(async (tx) => {
      const [err1, created] = await tx.tables.users.upsert({
        where: { email: "upsert@example.com" },
        create: { name: "Upserted", email: "upsert@example.com" },
        update: { name: "Updated" },
      });
      if (err1) return err(err1.type, err1.message);

      return ok(created);
    });

    expect(error).toBeNull();
    expect(result?.name).toBe("Upserted");

    const [, found] = await orm.tables.users.findUnique({
      where: { email: "upsert@example.com" },
    });
    expect(found?.name).toBe("Upserted");
  });

  test("should use createMany within transaction", async () => {
    const [error, result] = await orm.transaction(async (tx) => {
      const [err1, created] = await tx.tables.users.createMany([
        { name: "Batch1", email: "batch1@example.com" },
        { name: "Batch2", email: "batch2@example.com" },
      ]);
      if (err1) return err(err1.type, err1.message);

      return ok(created);
    });

    expect(error).toBeNull();
    expect(result?.length).toBe(2);

    const [, count] = await orm.tables.users.count();
    expect(count).toBe(2);
  });
});

afterAll(async () => {
  await orm.sql`DROP TABLE IF EXISTS test_posts`;
  await orm.sql`DROP TABLE IF EXISTS test_users`;
  await orm.close();
});

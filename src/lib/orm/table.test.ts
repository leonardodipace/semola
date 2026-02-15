import { beforeAll, describe, expect, test } from "bun:test";
import { boolean, date, number, string } from "./column.js";
import { Orm } from "./index.js";
import { Table } from "./table.js";

const testUrl =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/semola_test";

const usersTable = new Table("test_users", {
  id: number("id").primaryKey(),
  name: string("name").notNull(),
  email: string("email").unique().notNull(),
  active: boolean("active").default(true),
  createdAt: date("created_at").default(new Date()),
});

const orm = new Orm({
  url: testUrl,
  tables: {
    users: usersTable,
  },
});

describe("Table - findMany with where clause", () => {
  beforeAll(async () => {
    // Setup test table
    await orm.sql`DROP TABLE IF EXISTS test_users CASCADE`;
    await orm.sql`
      CREATE TABLE test_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    await orm.sql`DROP TABLE IF EXISTS test_nullable CASCADE`;
    await orm.sql`
      CREATE TABLE test_nullable (
        id SERIAL PRIMARY KEY,
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

    const nullableOrm = new Orm({
      url: testUrl,
      tables: { nullable: nullableTable },
    });

    const nullNameRows = await nullableOrm.tables.nullable.findMany({
      where: { name: null },
    });
    expect(nullNameRows.length).toBe(1);
    expect(nullNameRows[0]?.value).toBe(200);

    const nullValueRows = await nullableOrm.tables.nullable.findMany({
      where: { value: null },
    });
    expect(nullValueRows.length).toBe(1);
    expect(nullValueRows[0]?.name).toBe("another");

    // Cleanup
    await orm.sql`DROP TABLE IF EXISTS test_nullable CASCADE`;
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
    await expect(
      orm.tables.users.findMany({
        // @ts-expect-error - Testing runtime validation of invalid columns
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
    const users = await orm.tables.users.findMany({
      where: {
        active: true,
        id: { gte: 2 },
      },
    });
    expect(users.length).toBe(2);
    expect(users.every((u) => u.active && u.id >= 2)).toBe(true);
  });
});

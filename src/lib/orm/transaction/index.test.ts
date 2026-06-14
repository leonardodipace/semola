import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { createOrm } from "../orm/index.js";
import { defineTable } from "../table/index.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").notNull().unique(),
});

const accountsTable = defineTable("accounts", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  balance: string("balance").notNull(),
});

describe("$transaction", () => {
  test("interactive transaction commits on success", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable, accounts: accountsTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );
    await orm.$raw.unsafe(
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, balance TEXT NOT NULL)",
    );

    const result = await orm.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          id: "u1",
          name: "Alice",
          email: "alice@example.com",
        },
      });

      const account = await tx.accounts.create({
        data: {
          id: "a1",
          userId: user.id,
          balance: "1000",
        },
      });

      return { user, account };
    });

    expect(result.user.id).toBe("u1");
    expect(result.account.userId).toBe("u1");

    const users = await orm.users.findMany();
    const accounts = await orm.accounts.findMany();

    expect(users).toHaveLength(1);
    expect(accounts).toHaveLength(1);

    await orm.$raw.close();
  });

  test("interactive transaction rolls back on error", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable, accounts: accountsTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );
    await orm.$raw.unsafe(
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, balance TEXT NOT NULL)",
    );

    await expect(
      orm.$transaction(async (tx) => {
        await tx.users.create({
          data: {
            id: "u1",
            name: "Alice",
            email: "alice@example.com",
          },
        });

        throw new Error("Rollback transaction");
      }),
    ).rejects.toThrow("Rollback transaction");

    const users = await orm.users.findMany();

    expect(users).toHaveLength(0);

    await orm.$raw.close();
  });

  test("transaction client has $raw access", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.$transaction(async (tx) => {
      await tx.$raw.unsafe("INSERT INTO users VALUES (?, ?, ?)", [
        "u1",
        "Alice",
        "alice@example.com",
      ]);

      const users = await tx.users.findMany();

      expect(users).toHaveLength(1);
    });

    const users = await orm.users.findMany();

    expect(users).toHaveLength(1);

    await orm.$raw.close();
  });

  test("nested queries within transaction work correctly", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable, accounts: accountsTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );
    await orm.$raw.unsafe(
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, balance TEXT NOT NULL)",
    );

    await orm.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          id: "u1",
          name: "Alice",
          email: "alice@example.com",
        },
      });

      await tx.accounts.createMany({
        data: [
          { id: "a1", userId: user.id, balance: "1000" },
          { id: "a2", userId: user.id, balance: "2000" },
        ],
      });

      const accounts = await tx.accounts.findMany({
        where: { userId: user.id },
      });

      expect(accounts).toHaveLength(2);
    });

    const accounts = await orm.accounts.findMany();

    expect(accounts).toHaveLength(2);

    await orm.$raw.close();
  });

  test("transaction supports update and delete operations", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.users.create({
      data: {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
      },
    });

    await orm.$transaction(async (tx) => {
      const updated = await tx.users.update({
        where: { id: "u1" },
        data: { name: "Alice Updated" },
      });

      expect(updated.name).toBe("Alice Updated");

      const deleted = await tx.users.delete({
        where: { id: "u1" },
      });

      expect(deleted.name).toBe("Alice Updated");

      const user = await tx.users.findUnique({
        where: { id: "u1" },
      });

      expect(user).toBeNull();
    });

    const user = await orm.users.findUnique({
      where: { id: "u1" },
    });

    expect(user).toBeNull();

    await orm.$raw.close();
  });

  test("multiple sequential transactions work independently", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.$transaction(async (tx) => {
      await tx.users.create({
        data: {
          id: "u1",
          name: "Alice",
          email: "alice@example.com",
        },
      });
    });

    await orm.$transaction(async (tx) => {
      await tx.users.create({
        data: {
          id: "u2",
          name: "Bob",
          email: "bob@example.com",
        },
      });
    });

    const users = await orm.users.findMany();

    expect(users).toHaveLength(2);

    await orm.$raw.close();
  });
});

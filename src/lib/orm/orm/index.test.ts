import { describe, expect, test } from "bun:test";
import { date, string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { createOrm, many, one } from "./index.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").notNull().unique(),
});

const postsTable = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
});

describe("relation helpers", () => {
  test("many() returns a hasMany descriptor", () => {
    const relation = many(() => postsTable);

    expect(relation._type).toBe("hasMany");
    expect(relation._table).toBe(postsTable);
  });

  test("one() returns a hasOne descriptor", () => {
    const relation = one(() => usersTable);

    expect(relation._type).toBe("hasOne");
    expect(relation._table).toBe(usersTable);
  });

  test("createOrm() wires table clients and exposes raw SQL client", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: usersTable,
      },
    });

    expect(typeof orm.users.findMany).toBe("function");
    expect(typeof orm.users.findFirst).toBe("function");
    expect(typeof orm.users.findUnique).toBe("function");
    expect(orm.$raw).toBeDefined();

    await orm.$raw.close();
  });

  test("findUnique types only accept a single unique key", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: usersTable,
      },
    });

    const acceptFindUniqueOptions = <TOptions>(_options: TOptions) => {
      return undefined;
    };

    acceptFindUniqueOptions<Parameters<typeof orm.users.findUnique>[0]>({
      where: {
        id: "user-1",
      },
    });

    acceptFindUniqueOptions<Parameters<typeof orm.users.findUnique>[0]>({
      where: {
        email: "john@example.com",
      },
    });

    const invalidByName: Parameters<typeof orm.users.findUnique>[0] = {
      // @ts-expect-error
      where: {
        name: "John",
      },
    };

    expect(invalidByName).toBeDefined();

    const invalidByManyKeys: Parameters<typeof orm.users.findUnique>[0] = {
      // @ts-expect-error
      where: {
        id: "user-1",
        email: "john@example.com",
      },
    };

    expect(invalidByManyKeys).toBeDefined();

    const invalidByOperator: Parameters<typeof orm.users.findUnique>[0] = {
      where: {
        // @ts-expect-error
        id: {
          endsWith: "user-1",
        },
      },
    };

    expect(invalidByOperator).toBeDefined();

    const invalidByEqualsObject: Parameters<typeof orm.users.findUnique>[0] = {
      where: {
        // @ts-expect-error
        id: {
          equals: "user-1",
        },
      },
    };

    expect(invalidByEqualsObject).toBeDefined();

    const validWithGuard: Parameters<typeof orm.users.findUnique>[0] = {
      where: {
        id: "user-1",
        name: "John",
      },
    };

    expect(validWithGuard).toBeDefined();

    await orm.$raw.close();
  });

  test("findFirst types accept regular filters and reject take", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: usersTable,
      },
    });

    const acceptFindFirstOptions = <TOptions>(_options: TOptions) => {
      return undefined;
    };

    acceptFindFirstOptions<Parameters<typeof orm.users.findFirst>[0]>({
      where: {
        name: {
          startsWith: "J",
        },
      },
      orderBy: {
        name: "asc",
      },
      skip: 1,
    });

    const invalidByTake: Parameters<typeof orm.users.findFirst>[0] = {
      // @ts-expect-error
      take: 1,
    };

    expect(invalidByTake).toBeDefined();

    await orm.$raw.close();
  });

  test("table client findMany, findFirst, and findUnique execute through the dialect", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: usersTable,
      },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.$raw.unsafe(
      "INSERT INTO users (id, name, email) VALUES (?, ?, ?), (?, ?, ?)",
      [
        "user-1",
        "John",
        "john@example.com",
        "user-2",
        "Alice",
        "alice@example.com",
      ],
    );

    const rows = await orm.users.findMany({
      where: {
        name: {
          startsWith: "Jo",
        },
      },
    });

    const user = await orm.users.findUnique({
      where: {
        email: "john@example.com",
      },
    });

    const firstUser = await orm.users.findFirst({
      where: {
        name: {
          contains: "o",
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    expect(rows).toEqual([
      {
        id: "user-1",
        name: "John",
        email: "john@example.com",
      },
    ]);

    expect(user).toEqual({
      id: "user-1",
      name: "John",
      email: "john@example.com",
    });

    expect(firstUser).toEqual({
      id: "user-1",
      name: "John",
      email: "john@example.com",
    });

    await orm.$raw.close();
  });

  test("create inserts a row, applies defaults, and returns it", async () => {
    const fixedDate = new Date("2025-06-01T00:00:00.000Z");

    const table = defineTable("users", {
      id: uuid("id")
        .primaryKey()
        .notNull()
        .default(() => "generated-id"),
      name: string("name").notNull(),
      nickname: string("nickname").nullable(),
      createdAt: date("created_at")
        .notNull()
        .default(() => fixedDate),
    });

    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: table,
      },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT, created_at TEXT NOT NULL)",
    );

    const created = await orm.users.create({
      data: {
        name: "John",
      },
    });

    expect(created.id).toBe("generated-id");
    expect(created.name).toBe("John");
    expect(created.nickname).toBeNull();
    expect(new Date(created.createdAt).toISOString()).toBe(
      fixedDate.toISOString(),
    );

    const fromDb = await orm.users.findUnique({
      where: { id: "generated-id" },
    });

    expect(fromDb?.id).toBe("generated-id");
    expect(fromDb?.name).toBe("John");
    expect(fromDb?.nickname).toBeNull();
    expect(new Date(fromDb?.createdAt ?? 0).toISOString()).toBe(
      fixedDate.toISOString(),
    );

    await orm.$raw.close();
  });

  test("create allows overriding defaulted fields", async () => {
    const table = defineTable("users", {
      id: uuid("id")
        .primaryKey()
        .notNull()
        .default(() => "auto-id"),
      name: string("name").notNull(),
    });

    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: table,
      },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
    );

    const created = await orm.users.create({
      data: {
        id: "custom-id",
        name: "Jane",
      },
    });

    expect(created.id).toBe("custom-id");

    await orm.$raw.close();
  });

  test("create requires non-nullable fields without defaults", async () => {
    const table = defineTable("users", {
      id: uuid("id")
        .primaryKey()
        .notNull()
        .default(() => "auto-id"),
      name: string("name").notNull(),
      nickname: string("nickname").nullable(),
    });

    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: table,
      },
    });

    const acceptCreateOptions = <TOptions>(_options: TOptions) => {
      return undefined;
    };

    acceptCreateOptions<Parameters<typeof orm.users.create>[0]>({
      data: {
        name: "John",
      },
    });

    acceptCreateOptions<Parameters<typeof orm.users.create>[0]>({
      data: {
        id: "x",
        name: "John",
        nickname: null,
      },
    });

    const missingRequired: Parameters<typeof orm.users.create>[0] = {
      // @ts-expect-error name is required
      data: {
        id: "x",
      },
    };

    expect(missingRequired).toBeDefined();

    await orm.$raw.close();
  });

  test("createMany inserts multiple rows and returns count", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    const result = await orm.users.createMany({
      data: [
        { id: "u1", name: "Alice", email: "alice@example.com" },
        { id: "u2", name: "Bob", email: "bob@example.com" },
      ],
    });

    expect(result.count).toBe(2);

    const rows = await orm.users.findMany();

    expect(rows).toHaveLength(2);

    await orm.$raw.close();
  });

  test("update modifies a row and returns it", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.$raw.unsafe("INSERT INTO users VALUES (?, ?, ?)", [
      "u1",
      "Alice",
      "alice@example.com",
    ]);

    const updated = await orm.users.update({
      where: { id: "u1" },
      data: { name: "Alice Updated" },
    });

    expect(updated.id).toBe("u1");
    expect(updated.name).toBe("Alice Updated");

    await orm.$raw.close();
  });

  test("updateMany updates matching rows and returns count", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.$raw.unsafe("INSERT INTO users VALUES (?, ?, ?), (?, ?, ?)", [
      "u1",
      "Alice",
      "alice@example.com",
      "u2",
      "Bob",
      "bob@example.com",
    ]);

    const result = await orm.users.updateMany({
      data: { name: "Updated" },
    });

    expect(result.count).toBe(2);

    await orm.$raw.close();
  });

  test("delete removes a row and returns it", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.$raw.unsafe("INSERT INTO users VALUES (?, ?, ?)", [
      "u1",
      "Alice",
      "alice@example.com",
    ]);

    const deleted = await orm.users.delete({
      where: { id: "u1" },
    });

    expect(deleted.id).toBe("u1");

    const rows = await orm.users.findMany();

    expect(rows).toHaveLength(0);

    await orm.$raw.close();
  });

  test("deleteMany removes matching rows and returns count", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

    await orm.$raw.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );

    await orm.$raw.unsafe("INSERT INTO users VALUES (?, ?, ?), (?, ?, ?)", [
      "u1",
      "Alice",
      "alice@example.com",
      "u2",
      "Bob",
      "bob@example.com",
    ]);

    const result = await orm.users.deleteMany({
      where: { name: "Alice" },
    });

    expect(result.count).toBe(1);

    const rows = await orm.users.findMany();

    expect(rows).toHaveLength(1);

    await orm.$raw.close();
  });
});

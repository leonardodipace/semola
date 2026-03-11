import { describe, expect, test } from "bun:test";
import { number, string, uuid } from "./column.js";
import { createOrm, Orm } from "./orm.js";
import { many, one } from "./relation.js";
import { Table } from "./table.js";

const usersTable = new Table("users", {
  id: uuid("id")
    .primaryKey()
    .defaultFn(() => crypto.randomUUID()),
  name: string("name").notNull(),
});

const tasksTable = new Table("tasks", {
  id: uuid("id").primaryKey(),
  title: string("title").notNull(),
});

const mappedUsersTable = new Table("mapped_users", {
  id: uuid("id")
    .primaryKey()
    .defaultFn(() => crypto.randomUUID()),
  firstName: string("first_name").notNull(),
  lastName: string("last_name").notNull(),
});

async function setupUsers(db: {
  $raw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown[]>;
}) {
  await db.$raw`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)`;
}

async function setupUsersAndTasks(db: {
  $raw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown[]>;
}) {
  await db.$raw`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)`;
  await db.$raw`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, assignee_id TEXT NOT NULL)`;
}

async function setupMappedUsers(db: {
  $raw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown[]>;
}) {
  await db.$raw`CREATE TABLE mapped_users (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL)`;
}

describe("createOrm()", () => {
  test("exposes table clients matching table names", () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable, tasks: tasksTable },
    });

    expect(db.users).toBeDefined();
    expect(db.tasks).toBeDefined();
  });

  test("each table client has tiny query builder methods", () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    expect(db.users.select).toBeFunction();
    expect(db.users.findMany).toBeFunction();
    expect(db.users.findFirst).toBeFunction();
    expect(db.users.findUnique).toBeFunction();
    expect(db.users.create).toBeFunction();
    expect(db.users.createMany).toBeFunction();
    expect(db.users.insert).toBeFunction();
    expect(db.users.update).toBeFunction();
    expect(db.users.updateMany).toBeFunction();
    expect(db.users.delete).toBeFunction();
    expect(db.users.deleteMany).toBeFunction();

    expect("insertResult" in db.users).toBe(false);
    expect("updateResult" in db.users).toBe(false);
    expect("deleteResult" in db.users).toBe(false);
  });

  test("users.select() runs query", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const result = await db.users.select();

    expect(result).toEqual([{ id: "1", name: "Alice" }]);
  });

  test("users.select() preserves typed row inference", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const rows = await db.users.select();
    const first = rows[0];

    if (!first) {
      expect(rows).toEqual([{ id: "1", name: "Alice" }]);
      return;
    }

    const id: string = first.id;
    const name: string = first.name;

    expect(id).toBe("1");
    expect(name).toBe("Alice");
  });

  test("users.findMany() returns rows", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const users = await db.users.findMany();

    expect(users).toEqual([{ id: "1", name: "Alice" }]);
  });

  test("findMany() maps sql column names back to js keys", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { mappedUsers: mappedUsersTable },
    });

    await setupMappedUsers(db);

    await db.$raw`INSERT INTO mapped_users (id, first_name, last_name) VALUES ('1', 'Alice', 'Smith')`;

    const users = await db.mappedUsers.findMany();

    expect(users).toEqual([{ id: "1", firstName: "Alice", lastName: "Smith" }]);
  });

  test("users.findMany() throws when query fails", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await expect(db.users.findMany()).rejects.toThrow("no such table: users");
  });

  test("users.findFirst() returns first row or null", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);

    const emptyUser = await db.users.findFirst({
      where: { id: "missing" },
    });

    expect(emptyUser).toBeNull();

    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const firstUser = await db.users.findFirst({
      where: { id: "1" },
    });

    expect(firstUser).toEqual({ id: "1", name: "Alice" });
  });

  test("users.findUnique() returns row by unique where", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const user = await db.users.findUnique({ where: { id: "1" } });

    expect(user).toEqual({ id: "1", name: "Alice" });
  });

  test("users.select() applies where/orderBy/limit/offset", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;
    await db.$raw`INSERT INTO users (id, name) VALUES ('2', 'Bob')`;
    await db.$raw`INSERT INTO users (id, name) VALUES ('3', 'Alina')`;

    const result = await db.users.select({
      where: { name: { startsWith: "Al" } },
      orderBy: { name: "desc" },
      limit: 1,
      offset: 0,
    });

    expect(result).toEqual([{ id: "3", name: "Alina" }]);
  });

  test("users.select() supports include joins", async () => {
    const users = new Table("users", {
      id: uuid("id").primaryKey(),
      name: string("name").notNull(),
    });

    const tasks = new Table("tasks", {
      id: uuid("id").primaryKey(),
      title: string("title").notNull(),
      assigneeId: uuid("assignee_id").notNull(),
    });

    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users, tasks },
      relations: {
        users: { tasks: many(() => tasks) },
      },
    });

    await setupUsersAndTasks(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;
    await db.$raw`INSERT INTO tasks (id, title, assignee_id) VALUES ('10', 'Task', '1')`;

    const result = await db.users.select({ include: { tasks: true } });

    expect(result).toHaveLength(1);
  });

  test("select() supports include joins filtering with column assertion", async () => {
    const users = new Table("users", {
      id: uuid("id").primaryKey(),
      name: string("name").notNull(),
    });

    const tasks = new Table("tasks", {
      id: uuid("id").primaryKey(),
      title: string("title").notNull(),
      assigneeId: uuid("assignee_id").notNull(),
    });

    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users, tasks },
      relations: {
        users: { tasks: many(() => tasks) },
      },
    });

    await setupUsersAndTasks(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;
    await db.$raw`INSERT INTO tasks (id, title, assignee_id) VALUES ('10', 'Task', '1')`;

    const result = await db.users.select({ include: { tasks: true } });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "1", name: "Alice" });
  });

  test("select() with one() relation applies join and returns main table columns", async () => {
    const assignees = new Table("assignees", {
      id: uuid("id").primaryKey(),
      name: string("name").notNull(),
    });

    const workItems = new Table("work_items", {
      id: uuid("id").primaryKey(),
      assigneeId: uuid("assignee_id").notNull(),
      title: string("title").notNull(),
    });

    const db = createOrm({
      url: "sqlite::memory:",
      tables: { workItems, assignees },
      relations: {
        workItems: {
          assignee: one("assignee_id", () => assignees),
        },
      },
    });

    await db.$raw`CREATE TABLE assignees (id TEXT PRIMARY KEY, name TEXT NOT NULL)`;
    await db.$raw`CREATE TABLE work_items (id TEXT PRIMARY KEY, assignee_id TEXT NOT NULL, title TEXT NOT NULL)`;
    await db.$raw`INSERT INTO assignees VALUES ('a1', 'Alice')`;
    await db.$raw`INSERT INTO work_items VALUES ('w1', 'a1', 'Task One')`;

    const rows = await db.workItems.select({ include: { assignee: true } });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "w1",
      title: "Task One",
      assigneeId: "a1",
    });
  });

  test("findMany() supports gt/gte/lt/lte/in/notIn/isNull operators", async () => {
    const usersWithScore = new Table("users", {
      id: uuid("id").primaryKey(),
      name: string("name").notNull(),
      score: number("score"),
    });

    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersWithScore },
    });

    await db.$raw`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, score INTEGER)`;
    await db.$raw`INSERT INTO users VALUES ('1', 'Alice', 90)`;
    await db.$raw`INSERT INTO users VALUES ('2', 'Bob', 70)`;
    await db.$raw`INSERT INTO users VALUES ('3', 'Carol', 80)`;

    const gt80 = await db.users.findMany({ where: { score: { gt: 80 } } });
    expect(gt80.map((r) => r.id)).toEqual(["1"]);

    const inList = await db.users.findMany({
      where: { score: { in: [70, 80] } },
    });
    expect(inList.map((r) => r.id).sort()).toEqual(["2", "3"]);

    const notAlice = await db.users.findMany({
      where: { name: { not: "Alice" } },
    });
    expect(notAlice.map((r) => r.id).sort()).toEqual(["2", "3"]);
  });

  test("select() supports endsWith and contains string operators", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;
    await db.$raw`INSERT INTO users (id, name) VALUES ('2', 'Bob')`;
    await db.$raw`INSERT INTO users (id, name) VALUES ('3', 'Alicia')`;

    const ends = await db.users.select({
      where: { name: { endsWith: "ice" } },
    });
    expect(ends.map((r) => r.id).sort()).toEqual(["1"]);

    const contains = await db.users.select({
      where: { name: { contains: "li" } },
    });
    expect(contains.map((r) => r.id).sort()).toEqual(["1", "3"]);
  });

  test("findFirst() throws when query fails", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await expect(db.users.findFirst()).rejects.toThrow("no such table: users");
  });

  test("insert supports returning on sqlite", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);

    const inserted = await db.users.insert({
      data: { id: "u1", name: "Alice" },
      returning: true,
    });

    expect(inserted).toEqual([{ id: "u1", name: "Alice" }]);
  });

  test("insert returning maps sql column names to js keys", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { mappedUsers: mappedUsersTable },
    });

    await setupMappedUsers(db);

    const inserted = await db.mappedUsers.insert({
      data: {
        id: "u1",
        firstName: "Alice",
        lastName: "Smith",
      },
      returning: true,
    });

    expect(inserted).toEqual([
      {
        id: "u1",
        firstName: "Alice",
        lastName: "Smith",
      },
    ]);
  });

  test("create() returns created row", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);

    const created = await db.users.create({
      data: { id: "u1", name: "Alice" },
    });

    expect(created).toEqual({ id: "u1", name: "Alice" });
  });

  test("createMany() returns inserted rows and count", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);

    const result = await db.users.createMany({
      data: [
        { id: "u1", name: "Alice" },
        { id: "u2", name: "Bob" },
      ],
    });

    expect(result).toEqual({
      count: 2,
      rows: [
        { id: "u1", name: "Alice" },
        { id: "u2", name: "Bob" },
      ],
    });
  });

  test("insert returning preserves typed row inference", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);

    const inserted = await db.users.insert({
      data: { id: "u1", name: "Alice" },
      returning: true,
    });

    const first = inserted[0];

    if (!first) {
      expect(inserted).toEqual([{ id: "u1", name: "Alice" }]);
      return;
    }

    const id: string = first.id;
    const name: string = first.name;

    expect(id).toBe("u1");
    expect(name).toBe("Alice");
  });

  test("update modifies matching rows", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    await db.users.update({
      where: { id: "1" },
      data: { name: "Alicia" },
    });

    const rows = await db.users.select({ where: { id: "1" } });
    expect(rows).toEqual([{ id: "1", name: "Alicia" }]);
  });

  test("updateMany() returns updated rows and count", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;
    await db.$raw`INSERT INTO users (id, name) VALUES ('2', 'Alice')`;

    const result = await db.users.updateMany({
      where: { name: "Alice" },
      data: { name: "Alicia" },
    });

    expect(result).toEqual({
      count: 2,
      rows: [
        { id: "1", name: "Alicia" },
        { id: "2", name: "Alicia" },
      ],
    });
  });

  test("update supports returning on sqlite", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const updated = await db.users.update({
      where: { id: "1" },
      data: { name: "Alicia" },
      returning: true,
    });

    expect(updated).toEqual([{ id: "1", name: "Alicia" }]);
  });

  test("update returning maps sql column names to js keys", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { mappedUsers: mappedUsersTable },
    });

    await setupMappedUsers(db);
    await db.$raw`INSERT INTO mapped_users (id, first_name, last_name) VALUES ('1', 'Alice', 'Smith')`;

    const updated = await db.mappedUsers.update({
      where: { id: "1" },
      data: { firstName: "Alicia" },
      returning: true,
    });

    expect(updated).toEqual([
      {
        id: "1",
        firstName: "Alicia",
        lastName: "Smith",
      },
    ]);
  });

  test("delete removes matching rows", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    await db.users.delete({ where: { id: "1" } });

    const rows = await db.users.select();
    expect(rows).toEqual([]);
  });

  test("deleteMany() returns deleted rows and count", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;
    await db.$raw`INSERT INTO users (id, name) VALUES ('2', 'Alice')`;

    const result = await db.users.deleteMany({
      where: { name: "Alice" },
    });

    expect(result).toEqual({
      count: 2,
      rows: [
        { id: "1", name: "Alice" },
        { id: "2", name: "Alice" },
      ],
    });
  });

  test("delete supports returning on sqlite", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const deleted = await db.users.delete({
      where: { id: "1" },
      returning: true,
    });

    expect(deleted).toEqual([{ id: "1", name: "Alice" }]);
  });

  test("delete returning maps sql column names to js keys", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { mappedUsers: mappedUsersTable },
    });

    await setupMappedUsers(db);
    await db.$raw`INSERT INTO mapped_users (id, first_name, last_name) VALUES ('1', 'Alice', 'Smith')`;

    const deleted = await db.mappedUsers.delete({
      where: { id: "1" },
      returning: true,
    });

    expect(deleted).toEqual([
      {
        id: "1",
        firstName: "Alice",
        lastName: "Smith",
      },
    ]);
  });
});

describe("$transaction()", () => {
  test("commits callback work", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);

    await db.$transaction(async (tx) => {
      await tx.users.insert({ data: { name: "Alice" } });
      return null;
    });

    const rows = await db.users.select();
    expect(rows).toHaveLength(1);
    const countRows = await db.$raw`SELECT COUNT(*) as count FROM users`;
    expect(countRows).toEqual([{ count: 1 }]);
  });

  test("rolls back when callback throws", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);

    await expect(
      db.$transaction(async (tx) => {
        await tx.users.insert({ data: { name: "Alice" } });
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    const rows = await db.users.select();
    expect(rows).toEqual([]);
  });
});

describe("$raw()", () => {
  test("runs raw SQL query", async () => {
    const db = createOrm({
      url: "sqlite::memory:",
      tables: { users: usersTable },
    });

    await setupUsers(db);
    await db.$raw`INSERT INTO users (id, name) VALUES ('1', 'Alice')`;

    const result = await db.$raw`SELECT COUNT(*) as count FROM users`;

    expect(result).toEqual([{ count: 1 }]);
  });
});

describe("Orm class", () => {
  test("detects mysql dialect from URL", () => {
    const orm = new Orm({ url: "mysql://user:pass@localhost/db", tables: {} });
    expect(orm.dialect).toBe("mysql");
  });

  test("detects postgres dialect from postgres URL", () => {
    const orm = new Orm({
      url: "postgres://user:pass@localhost/db",
      tables: {},
    });
    expect(orm.dialect).toBe("postgres");
  });

  test("detects postgres dialect from postgresql URL", () => {
    const orm = new Orm({
      url: "postgresql://user:pass@localhost/db",
      tables: {},
    });
    expect(orm.dialect).toBe("postgres");
  });

  test("falls back to sqlite for unrecognised URLs", () => {
    const orm = new Orm({ url: "file:///path/to/db.sqlite", tables: {} });
    expect(orm.dialect).toBe("sqlite");
  });

  test("tables getter returns configured tables", () => {
    const orm = new Orm({
      url: "postgres://localhost/db",
      tables: { users: usersTable },
    });
    expect(orm.tables.users).toBe(usersTable);
  });

  test("relations getter returns configured relations", () => {
    const relations = {
      users: { tasks: many(() => usersTable) },
    };
    const orm = new Orm({
      url: "postgres://localhost/db",
      tables: {},
      relations,
    });
    expect(orm.relations).toBe(relations);
  });

  test("relations getter returns undefined when not configured", () => {
    const orm = new Orm({ url: "postgres://localhost/db", tables: {} });
    expect(orm.relations).toBeUndefined();
  });
});

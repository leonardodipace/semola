import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boolean, many, number, one, ORM, string, Table } from "./index.js";

const usersTable = new Table("users", {
  id: number("id").primaryKey(),
  name: string("name").notNull(),
  email: string("email").unique().notNull(),
  active: boolean("active"),
});

const postsTable = new Table("posts", {
  id: number("id").primaryKey(),
  title: string("title").notNull(),
  content: string("content").notNull(),
  authorId: number("author_id").notNull(),
  createdAt: number("created_at").default(0),
  published: boolean("published").default(false),
});

const orm = new ORM({
  url: ":memory:",
  tables: {
    users: usersTable,
    posts: postsTable,
  },
  relations: {
    users: {
      posts: many(() => postsTable),
    },
    posts: {
      author: one("author_id", () => usersTable).notNull(),
    },
  },
});

let createdDaveId: number | undefined;

// ORM normalizes DB rows to the table's field names via `mapRow`.

beforeAll(async () => {
  await orm.db`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, active BOOLEAN)`;
  await orm.db`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, author_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL DEFAULT 0, published BOOLEAN NOT NULL DEFAULT 0)`;

  await orm.db`INSERT INTO users (name, email, active) VALUES ('Alice', 'alice@example.com', 1)`;
  await orm.db`INSERT INTO users (name, email, active) VALUES ('Bob', 'bob@example.com', 0)`;
  await orm.db`INSERT INTO users (name, email, active) VALUES ('Charlie', 'charlie@example.com', 1)`;

  await orm.db`INSERT INTO posts (title, content, author_id) VALUES ('Hello World', 'First post', 1)`;
  await orm.db`INSERT INTO posts (title, content, author_id) VALUES ('Second Post', 'More content', 1)`;
  await orm.db`INSERT INTO posts (title, content, author_id) VALUES ('Bob Post', 'Bob writes', 2)`;
});

afterAll(async () => {
  await orm.close();
});

describe("ORM", () => {
  describe("findMany", () => {
    test("should return all rows", async () => {
      const users = await orm.users.findMany();
      expect(users.length).toBe(3);
      expect(users[0]!.name).toBe("Alice");
    });

    test("should filter with where", async () => {
      const users = await orm.users.findMany({ where: { name: "Alice" } });
      expect(users.length).toBe(1);
      expect(users[0]!.email).toBe("alice@example.com");
    });

    test("should paginate with take and skip", async () => {
      const users = await orm.users.findMany({ take: 2, skip: 1 });
      expect(users.length).toBe(2);
      expect(users[0]!.name).toBe("Bob");
    });

    test("should include many relations", async () => {
      const users = await orm.users.findMany({
        where: { name: "Alice" },
        include: { posts: true },
      });
      expect(users.length).toBe(1);
      expect(users[0]!.posts!.length).toBe(2);
      expect(users[0]!.posts![0]!.title).toBe("Hello World");
    });

    test("should return empty array for many relation with no matches", async () => {
      const users = await orm.users.findMany({
        where: { name: "Charlie" },
        include: { posts: true },
      });
      expect(users.length).toBe(1);
      expect(users[0]!.posts!.length).toBe(0);
    });

    test("should filter with many relation some", async () => {
      const users = await orm.users.findMany({
        where: { posts: { some: { title: "Hello World" } } },
      });
      expect(users.length).toBe(1);
      expect(users[0]!.name).toBe("Alice");
    });

    test("should filter with many relation none", async () => {
      const users = await orm.users.findMany({
        where: { posts: { none: { title: "Hello World" } } },
      });
      expect(users.length).toBe(2);
      const names = users.map((u) => u.name);
      expect(names).toContain("Bob");
      expect(names).toContain("Charlie");
    });
  });

  describe("findOne", () => {
    test("should return a single row", async () => {
      const user = await orm.users.findOne({
        where: { email: "bob@example.com" },
      });
      expect(user).not.toBeNull();
      expect(user!.name).toBe("Bob");
    });

    test("should return null when not found", async () => {
      const user = await orm.users.findOne({
        where: { email: "nobody@example.com" },
      });
      expect(user).toBeNull();
    });

    test("should include one relation", async () => {
      const post = await orm.posts.findOne({
        where: { title: "Hello World" },
        include: { author: true },
      });
      expect(post).not.toBeNull();
      expect(post!.author.name).toBe("Alice");
    });
  });

  describe("create", () => {
    test("should insert a new row and return it", async () => {
      const user = await orm.users.create({
        data: { name: "Dave", email: "dave@example.com" },
      });
      expect(user.name).toBe("Dave");
      expect(user.email).toBe("dave@example.com");
      expect(user.id).toBeDefined();
      createdDaveId = user.id as number;
    });

    test("should create a post with foreign key", async () => {
      expect(createdDaveId).toBeDefined();
      const post = await orm.posts.create({
        data: {
          title: "Dave Post",
          content: "Dave writes",
          authorId: createdDaveId!,
        },
      });
      expect(post.title).toBe("Dave Post");
    });

    test("should create a post and return defaulted fields", async () => {
      expect(createdDaveId).toBeDefined();
      const post = await orm.posts.create({
        data: {
          title: "Defaulted Post",
          content: "Has defaults",
          authorId: createdDaveId!,
        },
      });

      expect(post).not.toBeNull();
      expect(post.createdAt).toBeDefined();
      expect(post.published === false).toBeTruthy();
    });
  });

  describe("update", () => {
    test("should update a row and return it", async () => {
      const user = await orm.users.update({
        where: { name: "Dave" },
        data: { email: "dave.updated@example.com" },
      });
      expect(user!.email).toBe("dave.updated@example.com");
    });
  });

  describe("delete", () => {
    test("should delete a row and return it", async () => {
      const post = await orm.posts.delete({ where: { title: "Dave Post" } });
      expect(post!.title).toBe("Dave Post");

      const check = await orm.posts.findOne({ where: { title: "Dave Post" } });
      expect(check).toBeNull();
    });
  });

  describe("schema", () => {
    test("Column should track properties", () => {
      const col = string("test_col").notNull().primaryKey().unique();
      expect(col.sqlName).toBe("test_col");
      expect(col.isNullable).toBe(false);
      expect(col.isPrimaryKey).toBe(true);
      expect(col.isUnique).toBe(true);
    });

    test("Table should expose sqlName and columns", () => {
      expect(usersTable.sqlName).toBe("users");
      expect(usersTable.columns.id.sqlName).toBe("id");
    });

    test("Column default should set value and make not nullable", () => {
      const col = number("count").default(10);
      expect(col.defaultValue).toBe(10);
      expect(col.isNullable).toBe(false);
    });

    test("Column notNull should preserve other properties", () => {
      const col = string("test").unique().notNull();
      expect(col.isUnique).toBe(true);
      expect(col.isNullable).toBe(false);
    });
  });

  describe("update edge cases", () => {
    test("should return null when updating non-existent row", async () => {
      const user = await orm.users.update({
        where: { name: "NonExistent" },
        data: { email: "test@example.com" },
      });
      expect(user).toBeNull();
    });

    test("should update multiple fields", async () => {
      const user = await orm.users.update({
        where: { name: "Charlie" },
        data: { email: "charlie.new@example.com", active: false },
      });
      expect(user).not.toBeNull();
      expect(user!.email).toBe("charlie.new@example.com");
      expect(user!.active).toBe(false);
    });
  });

  describe("delete edge cases", () => {
    test("should return null when deleting non-existent row", async () => {
      const post = await orm.posts.delete({
        where: { title: "NonExistent" },
      });
      expect(post).toBeNull();
    });
  });

  describe("where filtering", () => {
    test("should filter with null values", async () => {
      const users = await orm.users.findMany({ where: { active: null } });
      expect(users).toBeInstanceOf(Array);
    });

    test("should combine multiple where conditions", async () => {
      const users = await orm.users.findMany({
        where: { name: "Alice", active: true },
      });
      expect(users.length).toBe(1);
      expect(users[0]!.name).toBe("Alice");
      expect(users[0]!.active).toBe(true);
    });

    test("should match boolean false", async () => {
      await orm.users.update({
        where: { name: "Bob" },
        data: { active: false },
      });
      const users = await orm.users.findMany({ where: { active: false } });
      expect(users.length).toBeGreaterThan(0);
      expect(users.some((u) => u.name === "Bob")).toBe(true);
    });
  });

  describe("pagination edge cases", () => {
    test("should handle skip beyond results", async () => {
      const users = await orm.users.findMany({ take: 10, skip: 100 });
      expect(users.length).toBe(0);
    });

    test("should handle take larger than results", async () => {
      const users = await orm.users.findMany({ take: 100 });
      expect(users.length).toBeGreaterThan(0);
    });

    test("should handle take: 0", async () => {
      const users = await orm.users.findMany({ take: 0 });
      expect(users.length).toBe(0);
    });
  });

  describe("relations advanced", () => {
    test("should handle multiple includes", async () => {
      const posts = await orm.posts.findMany({
        where: { title: "Hello World" },
        include: { author: true },
      });
      expect(posts.length).toBe(1);
      expect(posts[0]!.author).toBeDefined();
      expect(posts[0]!.author.name).toBe("Alice");
    });

    test("should handle findOne with non-nullable one relation", async () => {
      const post = await orm.posts.findOne({
        where: { title: "Second Post" },
        include: { author: true },
      });
      expect(post).not.toBeNull();
      expect(post!.author).toBeDefined();
      expect(post!.author.name).toBe("Alice");
    });

    test("should filter with many relation some matching multiple", async () => {
      const users = await orm.users.findMany({
        where: { posts: { some: { published: false } } },
      });
      expect(users.length).toBeGreaterThan(0);
    });
  });

  describe("create validation", () => {
    test("should create with all optional fields omitted", async () => {
      const user = await orm.users.create({
        data: { name: "Minimal", email: "minimal@example.com" },
      });
      expect(user).toBeDefined();
      expect(user.name).toBe("Minimal");
    });

    test("should create and retrieve with defaults", async () => {
      const post = await orm.posts.create({
        data: {
          title: "Check Defaults",
          content: "Testing defaults",
          authorId: 1,
        },
      });
      expect(post.createdAt).toBe(0);
      expect(post.published).toBe(false);
    });
  });

  describe("complex queries", () => {
    test("should chain where with include", async () => {
      const users = await orm.users.findMany({
        where: { active: true },
        include: { posts: true },
        take: 2,
      });
      expect(users.length).toBeGreaterThan(0);
      expect(users.length).toBeLessThanOrEqual(2);
    });

    test("should handle empty results with include", async () => {
      const users = await orm.users.findMany({
        where: { name: "Nobody" },
        include: { posts: true },
      });
      expect(users.length).toBe(0);
    });
  });

  describe("type safety", () => {
    test("should handle number fields correctly", async () => {
      const post = await orm.posts.findOne({ where: { id: 1 } });
      expect(post).not.toBeNull();
      expect(typeof post!.id).toBe("number");
      expect(typeof post!.authorId).toBe("number");
    });

    test("should handle boolean fields correctly", async () => {
      const user = await orm.users.findOne({ where: { name: "Alice" } });
      expect(user).not.toBeNull();
      expect(typeof user!.active).toBe("boolean");
    });

    test("should handle string fields correctly", async () => {
      const user = await orm.users.findOne({ where: { name: "Alice" } });
      expect(user).not.toBeNull();
      expect(typeof user!.name).toBe("string");
      expect(typeof user!.email).toBe("string");
    });
  });
});

import { describe, expect, test } from "bun:test";
import { mightThrow } from "../../errors/index.js";
import { boolean, date, json, number, string, uuid } from "../column/index.js";
import type { Column } from "../column/types.js";
import {
  integrationAdapters,
  PG_ID,
  PG_ID_2,
  PG_ID_3,
} from "../integration-helpers.js";
import { defineTable } from "../table/index.js";
import type { Table } from "../table/types.js";
import { createOrm, many, one } from "./index.js";
import { getOrmConnectionUrl } from "./orm.js";

const usersTable = defineTable({
  sqlName: "users",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    name: string("name").notNull(),
    email: string("email").notNull().unique(),
    isActive: boolean("is_active")
      .notNull()
      .default(() => true),
    createdAt: date("created_at").notNull(),
  },
});

const postsTable = defineTable({
  sqlName: "posts",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    title: string("title").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.columns.id),
  },
});

const metaTable = defineTable({
  sqlName: "meta",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    payload: json("payload").notNull(),
  },
});

const schemaSql = {
  sqlite: {
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, is_active INTEGER NOT NULL, created_at TEXT NOT NULL)",
    posts:
      "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, author_id TEXT NOT NULL)",
    meta: "CREATE TABLE meta (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
  },
  postgres: {
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, is_active BOOLEAN NOT NULL, created_at TIMESTAMP NOT NULL)",
    posts:
      "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, author_id TEXT NOT NULL)",
    meta: "CREATE TABLE meta (id TEXT PRIMARY KEY, payload JSONB NOT NULL)",
  },
} as const;

for (const live of integrationAdapters()) {
  const describeLive = live.adapter === "postgres" ? describe.serial : describe;

  describeLive(`${live.adapter} orm integration`, () => {
    const ddl = schemaSql[live.adapter];
    const id = live.adapter === "postgres" ? PG_ID : "u1";
    const id2 = live.adapter === "postgres" ? PG_ID_2 : "u2";
    const postId = live.adapter === "postgres" ? PG_ID_3 : "p1";

    const open = async () => {
      await live.beforeEach?.();

      const orm = createOrm({
        adapter: live.adapter,
        url: live.url,
        tables: { users: usersTable, posts: postsTable, meta: metaTable },
        relations: {
          users: { posts: many(() => postsTable) },
          posts: { author: one("authorId", () => usersTable) },
        },
      });

      await orm.$raw.unsafe(ddl.users);
      await orm.$raw.unsafe(ddl.posts);
      await orm.$raw.unsafe(ddl.meta);

      return orm;
    };

    test("crud round-trip with defaults and filters", async () => {
      const orm = await open();

      const created = await orm.users.create({
        data: {
          id,
          name: "Ada",
          email: "ada@example.com",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });
      await orm.users.create({
        data: {
          id: id2,
          name: "Grace",
          email: "grace@example.com",
          isActive: false,
          createdAt: new Date("2025-01-02T00:00:00.000Z"),
        },
      });

      expect(created.isActive).toBe(true);

      const found = await orm.users.findUnique({ where: { id } });
      const inactive = await orm.users.findMany({
        where: { isActive: false },
      });
      const updated = await orm.users.update({
        where: { id },
        data: { name: "Augusta" },
      });
      const deleted = await orm.users.delete({ where: { id: id2 } });

      expect(found?.email).toBe("ada@example.com");
      expect(inactive).toHaveLength(1);
      expect(updated.name).toBe("Augusta");
      expect(deleted.id).toBe(id2);
      expect(await orm.users.findUnique({ where: { id: id2 } })).toBeNull();

      await orm.$raw.close();
    });

    test("json string dbDefault is stored as valid JSON", async () => {
      await live.beforeEach?.();

      const items = defineTable({
        sqlName: "items",
        columns: {
          id: uuid("id").primaryKey().notNull(),
          label: json("label").notNull().dbDefault("anon"),
        },
      });
      const defaultSql = items.columns.label?._meta.dbDefault;

      if (!defaultSql) {
        throw new Error("missing dbDefault");
      }

      expect(JSON.parse(defaultSql.slice(1, -1).replaceAll("''", "'"))).toBe(
        "anon",
      );

      const sqlType = live.adapter === "postgres" ? "JSON" : "TEXT";
      const orm = createOrm({
        adapter: live.adapter,
        url: live.url,
        tables: { items },
      });

      await orm.$raw.unsafe(
        `CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL, label ${sqlType} NOT NULL DEFAULT ${defaultSql})`,
      );

      const created = await orm.items.create({ data: { id } });

      expect(created.label).toBe("anon");

      const selectSql =
        live.adapter === "postgres"
          ? "SELECT label::text AS label FROM items WHERE id = $1"
          : "SELECT label FROM items WHERE id = ?";
      const [stored] = await orm.$raw.unsafe(selectSql, [id]);

      expect(JSON.parse(String(stored?.label))).toBe("anon");

      await orm.$raw.close();
    });

    test("relation includes and JSON columns", async () => {
      const orm = await open();

      await orm.users.create({
        data: {
          id,
          name: "Ada",
          email: "ada@example.com",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });
      await orm.posts.createMany({
        data: [
          { id: postId, title: "First", authorId: id },
          {
            id: live.adapter === "postgres" ? PG_ID_2 : "p2",
            title: "Second",
            authorId: id,
          },
        ],
      });
      await orm.meta.create({
        data: { id, payload: { tags: ["orm", "live"] } },
      });

      const withPosts = await orm.users.findFirst({
        where: { id },
        include: {
          posts: { orderBy: { title: "asc" } },
        },
      });
      const withAuthor = await orm.posts.findFirst({
        where: { title: "First" },
        include: { author: true },
      });
      const meta = await orm.meta.findUnique({ where: { id } });

      expect(withPosts?.posts?.map((post) => post.title)).toEqual([
        "First",
        "Second",
      ]);
      expect(withAuthor?.author?.name).toBe("Ada");
      expect(meta?.payload).toEqual({ tags: ["orm", "live"] });

      await orm.$raw.close();
    });

    test("bulk updateMany and deleteMany", async () => {
      const orm = await open();

      await orm.users.createMany({
        data: [
          {
            id,
            name: "Ada",
            email: "ada@example.com",
            isActive: false,
            createdAt: new Date("2025-01-01T00:00:00.000Z"),
          },
          {
            id: id2,
            name: "Grace",
            email: "grace@example.com",
            isActive: false,
            createdAt: new Date("2025-01-02T00:00:00.000Z"),
          },
        ],
      });

      const updated = await orm.users.updateMany({
        where: { isActive: false },
        data: { name: "Inactive" },
      });
      const deleted = await orm.users.deleteMany({
        where: { name: "Inactive" },
      });

      expect(updated).toHaveLength(2);
      expect(deleted).toHaveLength(2);
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });
  });
}

describe("sqlite orm integration", () => {
  const usersTable = defineTable({
    sqlName: "users",
    columns: {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
      email: string("email").notNull().unique(),
    },
  });

  const postsTable = defineTable({
    sqlName: "posts",
    columns: {
      id: uuid("id").primaryKey().notNull(),
      title: string("title").notNull(),
    },
  });

  const createUsersOrm = () =>
    createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
    });

  const createUsersOrmWithModifyingBeforeCreate = () =>
    createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable },
      hooks: {
        beforeCreate(ctx) {
          return {
            data: {
              ...ctx.options.data,
              name: "Modified",
            },
          };
        },
      },
    });

  const createUsersSchema = async (sql: Bun.SQL) => {
    await sql.unsafe(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );
  };

  const seedSingleUser = async (sql: Bun.SQL) => {
    await sql.unsafe("INSERT INTO users VALUES (?, ?, ?)", [
      "u1",
      "Alice",
      "alice@example.com",
    ]);
  };

  const seedTwoUsers = async (sql: Bun.SQL) => {
    await sql.unsafe("INSERT INTO users VALUES (?, ?, ?), (?, ?, ?)", [
      "u1",
      "Alice",
      "alice@example.com",
      "u2",
      "Bob",
      "bob@example.com",
    ]);
  };

  type TableWithId = Table<{ id: Column }>;

  const defineStudentsToExamsTable = (
    studentTable: TableWithId,
    examsTable: TableWithId,
  ) =>
    defineTable({
      sqlName: "students_to_exams",
      columns: {
        studentId: uuid("student_id")
          .primaryKey()
          .notNull()
          .references(() => studentTable.columns.id),
        examId: uuid("exam_id")
          .primaryKey()
          .notNull()
          .references(() => examsTable.columns.id),
      },
    });

  describe("relation helpers", () => {
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
      expect(orm.$config.adapter).toBe("sqlite");
      expect(orm.$config.url).toBe(":memory:");
      expect(orm.$config.tables.users).toBe(usersTable);

      await orm.$raw.close();
    });

    test("redacts credentials from the public $config url", async () => {
      const orm = createOrm({
        adapter: "postgres",
        url: "postgres://user:secret@localhost:5432/app",
        tables: {
          users: usersTable,
        },
      });

      expect(orm.$config.url).not.toContain("secret");
      expect(orm.$config.url).not.toContain("user");
      expect(orm.$config.url).toContain("localhost");
      expect(getOrmConnectionUrl(orm)).toBe(
        "postgres://user:secret@localhost:5432/app",
      );

      await orm.$raw.close();
    });

    test("enforces sqlite foreign keys on the first query inside a transaction", async () => {
      const authors = defineTable({
        sqlName: "authors",
        columns: {
          id: uuid("id").primaryKey().notNull(),
        },
      });
      const posts = defineTable({
        sqlName: "posts",
        columns: {
          id: uuid("id").primaryKey().notNull(),
          authorId: uuid("author_id")
            .notNull()
            .references(() => authors.columns.id),
        },
      });
      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { authors, posts },
      });

      await orm.$raw`
      CREATE TABLE authors (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE posts (
        id TEXT PRIMARY KEY NOT NULL,
        author_id TEXT NOT NULL REFERENCES authors(id)
      );
    `;

      const [error] = await mightThrow(
        orm.$transaction(async (tx) => {
          await tx.posts.create({
            data: { id: "p1", authorId: "missing" },
          });
        }),
      );

      expect(error?.message).toContain("FOREIGN KEY");

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

    test("create omits unspecified dbDefault columns and persists decimal numbers", async () => {
      const table = defineTable({
        sqlName: "items",
        columns: {
          id: number("id").primaryKey().notNull(),
          name: string("name").notNull().dbDefault("anon"),
          price: number("price").notNull(),
        },
      });
      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { items: table },
      });

      await orm.$raw.unsafe(
        "CREATE TABLE items (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT 'anon', price REAL NOT NULL)",
      );

      const created = await orm.items.create({
        data: {
          id: 1,
          price: 1.5,
        },
      });

      expect(created).toEqual({
        id: 1,
        name: "anon",
        price: 1.5,
      });

      await orm.$raw.close();
    });

    test("create inserts a row, applies defaults, and returns it", async () => {
      const fixedDate = new Date("2025-06-01T00:00:00.000Z");

      const table = defineTable({
        sqlName: "users",
        columns: {
          id: uuid("id")
            .primaryKey()
            .notNull()
            .default(() => "generated-id"),
          name: string("name").notNull(),
          nickname: string("nickname").nullable(),
          createdAt: date("created_at")
            .notNull()
            .default(() => fixedDate),
        },
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
      const table = defineTable({
        sqlName: "users",
        columns: {
          id: uuid("id")
            .primaryKey()
            .notNull()
            .default(() => "auto-id"),
          name: string("name").notNull(),
        },
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

    test("createMany inserts multiple rows and returns the inserted records", async () => {
      const orm = createUsersOrm();

      await createUsersSchema(orm.$raw);

      const result = await orm.users.createMany({
        data: [
          { id: "u1", name: "Alice", email: "alice@example.com" },
          { id: "u2", name: "Bob", email: "bob@example.com" },
        ],
      });

      expect(result).toHaveLength(2);

      const rows = await orm.users.findMany();

      expect(rows).toHaveLength(2);

      await orm.$raw.close();
    });

    test("update modifies a row and returns it", async () => {
      const orm = createUsersOrm();

      await createUsersSchema(orm.$raw);
      await seedSingleUser(orm.$raw);

      const updated = await orm.users.update({
        where: { id: "u1" },
        data: { name: "Alice Updated" },
      });

      expect(updated.id).toBe("u1");
      expect(updated.name).toBe("Alice Updated");

      await orm.$raw.close();
    });

    test("updateMany updates matching rows and returns the updated records", async () => {
      const orm = createUsersOrm();

      await createUsersSchema(orm.$raw);
      await seedTwoUsers(orm.$raw);

      const result = await orm.users.updateMany({
        data: { name: "Updated" },
      });

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.name === "Updated")).toBe(true);

      await orm.$raw.close();
    });

    test("delete removes a row and returns it", async () => {
      const orm = createUsersOrm();

      await createUsersSchema(orm.$raw);
      await seedSingleUser(orm.$raw);

      const deleted = await orm.users.delete({
        where: { id: "u1" },
      });

      expect(deleted.id).toBe("u1");

      const rows = await orm.users.findMany();

      expect(rows).toHaveLength(0);

      await orm.$raw.close();
    });

    test("deleteMany removes matching rows and returns the deleted records", async () => {
      const orm = createUsersOrm();

      await createUsersSchema(orm.$raw);
      await seedTwoUsers(orm.$raw);

      const result = await orm.users.deleteMany({
        where: { name: "Alice" },
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("u1");

      const rows = await orm.users.findMany();

      expect(rows).toHaveLength(1);

      await orm.$raw.close();
    });
  });

  describe("relation where filters", () => {
    const postsTable = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        title: string("title").notNull(),
        published: boolean("published")
          .notNull()
          .default(() => false),
        views: number("views")
          .notNull()
          .default(() => 0),
        authorId: uuid("author_id")
          .notNull()
          .references(() => usersTable.columns.id),
      },
    });

    const createOrmWithPosts = () =>
      createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable, posts: postsTable },
        relations: {
          users: { posts: many(() => postsTable) },
        },
      });

    const seedRelationFilterData = async (sql: Bun.SQL) => {
      await sql.unsafe(
        "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)",
      );
      await sql.unsafe(
        "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, published INTEGER NOT NULL, views INTEGER NOT NULL, author_id TEXT NOT NULL)",
      );
      await sql.unsafe(
        "INSERT INTO users VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
        [
          "u1",
          "Alice",
          "alice@example.com",
          "u2",
          "Bob",
          "bob@example.com",
          "u3",
          "Carol",
          "carol@example.com",
        ],
      );
      await sql.unsafe(
        "INSERT INTO posts (id, title, published, views, author_id) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
        [
          "p1",
          "Draft",
          0,
          10,
          "u1",
          "p2",
          "Published",
          1,
          150,
          "u1",
          "p3",
          "Popular",
          1,
          200,
          "u2",
          "p4",
          "Quiet",
          1,
          5,
          "u2",
        ],
      );
    };

    test("filters users where every post is published", async () => {
      const orm = createOrmWithPosts();

      await seedRelationFilterData(orm.$raw);

      const users = await orm.users.findMany({
        where: {
          posts: { every: { published: true } },
        },
        select: { id: true },
      });

      expect(users.map((user) => user.id).sort()).toEqual(["u2", "u3"]);

      await orm.$raw.close();
    });

    test("filters users where some post has more than 100 views", async () => {
      const orm = createOrmWithPosts();

      await seedRelationFilterData(orm.$raw);

      const users = await orm.users.findMany({
        where: {
          posts: { some: { views: { gt: 100 } } },
        },
        select: { id: true },
      });

      expect(users.map((user) => user.id).sort()).toEqual(["u1", "u2"]);

      await orm.$raw.close();
    });

    test("filters users with no posts", async () => {
      const orm = createOrmWithPosts();

      await seedRelationFilterData(orm.$raw);

      const users = await orm.users.findMany({
        where: {
          posts: { none: {} },
        },
        select: { id: true },
      });

      expect(users).toEqual([{ id: "u3" }]);

      await orm.$raw.close();
    });

    test("composes relation filters with column filters", async () => {
      const orm = createOrmWithPosts();

      await seedRelationFilterData(orm.$raw);

      const users = await orm.users.findMany({
        where: {
          name: { startsWith: "A" },
          posts: { some: { published: true } },
        },
        select: { id: true },
      });

      expect(users).toEqual([{ id: "u1" }]);

      await orm.$raw.close();
    });
  });

  describe("nested include options", () => {
    const authoredPostsTable = defineTable({
      sqlName: "posts",
      columns: {
        id: uuid("id").primaryKey().notNull(),
        title: string("title").notNull(),
        content: string("content").notNull(),
        userId: uuid("user_id")
          .notNull()
          .references(() => usersTable.columns.id),
      },
    });

    const createOrmWithPosts = () =>
      createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable, posts: authoredPostsTable },
        relations: {
          users: { posts: many(() => authoredPostsTable) },
        },
      });

    const definePostWithAuthorTable = (sqlName: string) =>
      defineTable({
        sqlName,
        columns: {
          id: uuid("id").primaryKey().notNull(),
          title: string("title").notNull(),
          userId: uuid("user_id")
            .notNull()
            .references(() => usersTable.columns.id),
        },
      });

    const definePostWithAuthorAndContentTable = (sqlName: string) =>
      defineTable({
        sqlName,
        columns: {
          id: uuid("id").primaryKey().notNull(),
          title: string("title").notNull(),
          content: string("content").notNull(),
          userId: uuid("user_id")
            .notNull()
            .references(() => usersTable.columns.id),
        },
      });

    const createOrmWithAuthorRelation = <
      TPostsTable extends ReturnType<typeof definePostWithAuthorTable>,
    >(
      postsTable: TPostsTable,
    ) =>
      createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable, posts: postsTable },
        relations: {
          users: { posts: many(() => postsTable) },
          posts: { author: one("userId", () => usersTable) },
        },
      });

    const createNestedIncludeSchemaAndRows = async (
      sql: Bun.SQL,
      postsSqlName: string,
    ) => {
      await sql.unsafe(
        "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)",
      );
      await sql.unsafe(
        `CREATE TABLE ${postsSqlName} (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, user_id TEXT NOT NULL)`,
      );
      await sql.unsafe("INSERT INTO users VALUES (?, ?, ?)", [
        "u1",
        "John",
        "john@example.com",
      ]);
      await sql.unsafe(
        `INSERT INTO ${postsSqlName} (id, title, content, user_id) VALUES (?, ?, ?, ?)`,
        ["p1", "Hello", "World", "u1"],
      );
    };

    test("select in nested include returns only requested columns at runtime", async () => {
      const orm = createOrmWithPosts();

      await createNestedIncludeSchemaAndRows(orm.$raw, "posts");

      const rows = await orm.users.findMany({
        include: { posts: { select: { title: true } } },
      });

      const post = rows[0]?.posts[0];

      expect(post?.title).toBe("Hello");
      expect(Object.keys(post ?? {})).toEqual(["title"]);

      await orm.$raw.close();
    });

    test("nested include propagates relation types (posts include author)", async () => {
      const postsWithAuthorTable =
        definePostWithAuthorTable("posts_with_author");
      const orm = createOrmWithAuthorRelation(postsWithAuthorTable);

      await orm.$raw.unsafe(
        "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)",
      );
      await orm.$raw.unsafe(
        "CREATE TABLE posts_with_author (id TEXT PRIMARY KEY, title TEXT NOT NULL, user_id TEXT NOT NULL)",
      );

      await orm.users.create({
        data: { id: "u1", name: "John", email: "john@example.com" },
      });
      await orm.posts.create({
        data: { id: "p1", title: "Hello", userId: "u1" },
      });

      const rows = await orm.users.findMany({
        include: { posts: { include: { author: true } } },
      });

      const post = rows[0]?.posts[0];
      const author = post?.author;

      expect(author?.name).toBe("John");

      const _nameCheck: string | null | undefined = author?.name;
      expect(_nameCheck).toBeDefined();

      await orm.$raw.close();
    });

    test("depth-3 nested include with select shows correct type (not never or missing)", async () => {
      const postsWithAuthorTable =
        definePostWithAuthorAndContentTable("posts_depth3");
      const orm = createOrmWithAuthorRelation(postsWithAuthorTable);

      await createNestedIncludeSchemaAndRows(orm.$raw, "posts_depth3");

      const rows = await orm.users.findMany({
        include: {
          posts: {
            include: {
              author: {
                include: {
                  posts: { select: { title: true } },
                },
              },
            },
          },
        },
      });

      const firstUser = rows[0];
      const firstPost = firstUser?.posts[0];
      const author = firstPost?.author;
      const authorPosts = author?.posts;

      expect(authorPosts).toBeDefined();
      expect(authorPosts?.[0]?.title).toBe("Hello");
      expect(Object.keys(authorPosts?.[0] ?? {})).toEqual(["title"]);

      await orm.$raw.close();
    });

    test("deep bidirectional include matches runtime and inferred type", async () => {
      const exampleUsersTable = defineTable({
        sqlName: "users",
        columns: {
          id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
          firstName: string("first_name").notNull(),
          lastName: string("last_name").notNull(),
        },
      });

      const examplePostsTable = defineTable({
        sqlName: "posts",
        columns: {
          id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
          title: string("title").notNull(),
          content: string("content").notNull(),
          authorId: uuid("author_id")
            .notNull()
            .references(() => exampleUsersTable.columns.id),
        },
      });

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: {
          users: exampleUsersTable,
          posts: examplePostsTable,
        },
        relations: {
          users: {
            posts: many(() => examplePostsTable),
          },
          posts: {
            author: one("authorId", () => exampleUsersTable),
          },
        },
      });

      await orm.$raw`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL
      );

      CREATE TABLE posts (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL REFERENCES users(id)
      );
    `;

      const leo = await orm.users.create({
        data: {
          firstName: "Leonardo",
          lastName: "Dipace",
        },
      });

      await orm.posts.create({
        data: {
          title: "Hello World",
          content: "Hello World",
          authorId: leo.id,
        },
      });

      const result = await orm.users.findMany({
        include: {
          posts: {
            include: {
              author: {
                include: {
                  posts: {
                    include: {
                      author: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      const firstUser = result[0];
      const firstPost = firstUser?.posts[0];
      const author = firstPost?.author;
      const nestedPost = author?.posts[0];
      const nestedAuthor = nestedPost?.author;
      const nestedName: string | undefined = nestedAuthor?.firstName;

      expect(nestedName).toBe("Leonardo");
      expect(author?.posts).toHaveLength(1);
      expect(author?.lastName).toBe("Dipace");

      const selected = await orm.users.findMany({
        include: {
          posts: {
            select: {
              title: true,
            },
            include: {
              author: true,
            },
          },
        },
      });

      const selectedUser = selected[0];
      const selectedPost = selectedUser?.posts[0];
      const selectedTitle: string | undefined = selectedPost?.title;
      // @ts-expect-error content is not selected on posts
      const selectedContent = selectedPost?.content;

      expect(selectedTitle).toBe("Hello World");
      expect(selectedContent).toBeUndefined();

      await orm.$raw.close();
    });
  });

  describe("many to many relation", () => {
    test("should create a bi-directional relation", async () => {
      const studentTable = defineTable({
        sqlName: "students",
        columns: {
          id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
          createdAt: date("created_at")
            .notNull()
            .default(() => new Date()),
          updatedAt: date("updated_at")
            .notNull()
            .default(() => new Date()),
          firstName: string("first_name").notNull(),
          lastName: string("last_name").notNull(),
        },
      });

      const examsTable = defineTable({
        sqlName: "exams",
        columns: {
          id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
          createdAt: date("created_at")
            .notNull()
            .default(() => new Date()),
          updatedAt: date("updated_at")
            .notNull()
            .default(() => new Date()),
          name: string("name").notNull(),
        },
      });

      const studentsToExamsTable = defineStudentsToExamsTable(
        studentTable,
        examsTable,
      );

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: {
          students: studentTable,
          exams: examsTable,
          studentsToExams: studentsToExamsTable,
        },
        relations: {
          students: {
            studentsToExams: many(() => studentsToExamsTable),
          },
          exams: {
            studentsToExams: many(() => studentsToExamsTable),
          },

          studentsToExams: {
            student: one("studentId", () => studentTable),
            exam: one("examId", () => examsTable),
          },
        },
      });

      await orm.$raw`
        CREATE TABLE students (
            id TEXT PRIMARY KEY NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL
        );
    
        CREATE TABLE exams (
            id TEXT PRIMARY KEY NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            name TEXT NOT NULL
        );
    
        CREATE TABLE students_to_exams (
          student_id TEXT NOT NULL REFERENCES students(id),
          exam_id TEXT NOT NULL REFERENCES exams(id),
          PRIMARY KEY (student_id, exam_id)
        );
    `;

      await orm.exams.createMany({
        data: [
          {
            id: "E1",
            name: "Calcolo numerico",
          },
          {
            id: "E2",
            name: "Matematica Discreta",
          },
          {
            id: "E3",
            name: "Informatica",
          },
        ],
      });

      await orm.students.createMany({
        data: [
          {
            id: "S1",
            firstName: "Mario",
            lastName: "Draghi",
          },
          {
            id: "S2",
            firstName: "Silvia",
            lastName: "Toffanini",
          },
          {
            id: "S3",
            firstName: "Claudio",
            lastName: "Bisio",
          },
        ],
      });

      await orm.studentsToExams.createMany({
        data: [
          { examId: "E1", studentId: "S1" },
          { examId: "E1", studentId: "S2" },
          { examId: "E2", studentId: "S3" },
          { examId: "E2", studentId: "S1" },
          { examId: "E2", studentId: "S2" },
          { examId: "E3", studentId: "S1" },
          { examId: "E3", studentId: "S3" },
        ],
      });

      const [error] = await mightThrow(
        orm.studentsToExams.create({
          data: { examId: "E1", studentId: "missing" },
        }),
      );

      expect(error?.message).toContain("FOREIGN KEY");

      async function fromStudentsToExamsTable() {
        return orm.studentsToExams.findMany({
          include: { exam: true },
        });
      }

      async function fromExamTable() {
        return orm.exams.findMany({
          include: { studentsToExams: true },
        });
      }

      await expect(fromStudentsToExamsTable()).resolves.toBeDefined();
      await expect(fromExamTable()).resolves.toBeDefined();

      await orm.$raw.close();
    });

    test("relation name matching a table name does not cause a conflict", async () => {
      const studentTable = defineTable({
        sqlName: "students",
        columns: {
          id: uuid("id").primaryKey().notNull(),
          firstName: string("first_name").notNull(),
        },
      });

      const examsTable = defineTable({
        sqlName: "exams",
        columns: {
          id: uuid("id").primaryKey().notNull(),
          name: string("name").notNull(),
        },
      });

      const studentsToExamsTable = defineStudentsToExamsTable(
        studentTable,
        examsTable,
      );

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: {
          students: studentTable,
          exams: examsTable,
          studentsToExams: studentsToExamsTable,
        },
        relations: {
          studentsToExams: {
            exams: one("examId", () => examsTable),
          },
        },
      });

      await orm.$raw`
      CREATE TABLE students (id TEXT PRIMARY KEY NOT NULL, first_name TEXT NOT NULL);
      CREATE TABLE exams (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
      CREATE TABLE students_to_exams (
        student_id TEXT NOT NULL REFERENCES students(id),
        exam_id TEXT NOT NULL REFERENCES exams(id),
        PRIMARY KEY (student_id, exam_id)
      );
    `;

      await orm.students.createMany({
        data: [{ id: "S1", firstName: "John" }],
      });
      await orm.exams.createMany({ data: [{ id: "E1", name: "Math" }] });
      await orm.studentsToExams.createMany({
        data: [{ studentId: "S1", examId: "E1" }],
      });

      const rows = await orm.studentsToExams.findMany({
        include: { exams: true },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.exams).toMatchObject({ id: "E1", name: "Math" });

      await orm.$raw.close();
    });
  });

  describe("hooks", () => {
    test("beforeCreate can return modified options", async () => {
      const orm = createUsersOrmWithModifyingBeforeCreate();

      await createUsersSchema(orm.$raw);

      const created = await orm.users.create({
        data: { id: "u1", name: "Alice", email: "alice@example.com" },
      });

      expect(created.name).toBe("Modified");

      await orm.$raw.close();
    });

    test("afterCreate receives result", async () => {
      let afterResult: unknown;

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable },
        hooks: {
          afterCreate(ctx) {
            afterResult = ctx.result;
          },
        },
      });

      await createUsersSchema(orm.$raw);

      const created = await orm.users.create({
        data: { id: "u1", name: "Alice", email: "alice@example.com" },
      });

      expect(afterResult).toEqual(created);

      await orm.$raw.close();
    });

    test("beforeFindMany and afterFindMany receive table context", async () => {
      let beforeTableName: string | undefined;
      let afterTableName: string | undefined;
      let afterRowCount: number | undefined;

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable },
        hooks: {
          beforeFindMany(ctx) {
            beforeTableName = ctx.tableName;
          },
          afterFindMany(ctx) {
            afterTableName = ctx.tableName;
            afterRowCount = ctx.result?.length;
          },
        },
      });

      await createUsersSchema(orm.$raw);
      await seedTwoUsers(orm.$raw);

      await orm.users.findMany();

      expect(beforeTableName).toBe("users");
      expect(afterTableName).toBe("users");
      expect(afterRowCount).toBe(2);

      await orm.$raw.close();
    });

    test("throwing from a hook aborts the operation", async () => {
      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable },
        hooks: {
          beforeCreate() {
            throw new Error("blocked");
          },
        },
      });

      await createUsersSchema(orm.$raw);

      await expect(
        orm.users.create({
          data: { id: "u1", name: "Alice", email: "alice@example.com" },
        }),
      ).rejects.toThrow("blocked");

      const rows = await orm.users.findMany();
      expect(rows).toHaveLength(0);

      await orm.$raw.close();
    });

    test("hooks run inside $transaction", async () => {
      let hookCalls = 0;

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable },
        hooks: {
          beforeCreate() {
            hookCalls += 1;

            return undefined;
          },
        },
      });

      await createUsersSchema(orm.$raw);

      await orm.$transaction(async (tx) => {
        await tx.users.create({
          data: { id: "u1", name: "Alice", email: "alice@example.com" },
        });
      });

      expect(hookCalls).toBe(1);

      await orm.$raw.close();
    });

    test("throwing from a hook inside $transaction rolls back", async () => {
      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable },
        hooks: {
          afterCreate() {
            throw new Error("rollback");
          },
        },
      });

      await createUsersSchema(orm.$raw);

      await expect(
        orm.$transaction(async (tx) => {
          await tx.users.create({
            data: { id: "u1", name: "Alice", email: "alice@example.com" },
          });
        }),
      ).rejects.toThrow("rollback");

      const rows = await orm.users.findMany();
      expect(rows).toHaveLength(0);

      await orm.$raw.close();
    });

    test("works without configured hooks", async () => {
      const orm = createUsersOrm();

      await createUsersSchema(orm.$raw);

      const created = await orm.users.create({
        data: { id: "u1", name: "Alice", email: "alice@example.com" },
      });

      expect(created.name).toBe("Alice");

      await orm.$raw.close();
    });

    test("beforeCreate does not mutate caller options", async () => {
      const orm = createUsersOrmWithModifyingBeforeCreate();

      await createUsersSchema(orm.$raw);

      const options = {
        data: { id: "u1", name: "Alice", email: "alice@example.com" },
      };

      await orm.users.create(options);

      expect(options.data.name).toBe("Alice");

      await orm.$raw.close();
    });

    test("per-table hooks run only for matching table", async () => {
      let usersHookCalls = 0;
      let postsHookCalls = 0;

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable, posts: postsTable },
        hooks: {
          tables: {
            users: {
              beforeCreate() {
                usersHookCalls += 1;

                return undefined;
              },
            },
            posts: {
              beforeCreate() {
                postsHookCalls += 1;

                return undefined;
              },
            },
          },
        },
      });

      await createUsersSchema(orm.$raw);
      await orm.$raw.unsafe(
        "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
      );

      await orm.users.create({
        data: { id: "u1", name: "Alice", email: "alice@example.com" },
      });

      await orm.posts.create({
        data: { id: "p1", title: "Hello" },
      });

      expect(usersHookCalls).toBe(1);
      expect(postsHookCalls).toBe(1);

      await orm.$raw.close();
    });

    test("global and per-table beforeCreate hooks run in order", async () => {
      const callOrder: string[] = [];

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable },
        hooks: {
          beforeCreate(ctx) {
            callOrder.push("global");

            return {
              data: {
                ...ctx.options.data,
                name: "AfterGlobal",
              },
            };
          },
          tables: {
            users: {
              beforeCreate(ctx) {
                callOrder.push(`users:${ctx.options.data.name}`);

                return undefined;
              },
            },
          },
        },
      });

      await createUsersSchema(orm.$raw);

      const created = await orm.users.create({
        data: { id: "u1", name: "Alice", email: "alice@example.com" },
      });

      expect(callOrder).toEqual(["global", "users:AfterGlobal"]);
      expect(created.name).toBe("AfterGlobal");

      await orm.$raw.close();
    });

    test("$skipHooks bypasses hooks for a single call", async () => {
      let hookCalls = 0;

      const orm = createOrm({
        adapter: "sqlite",
        url: ":memory:",
        tables: { users: usersTable },
        hooks: {
          beforeCreate() {
            hookCalls += 1;

            throw new Error("should not run");
          },
        },
      });

      await createUsersSchema(orm.$raw);

      const created = await orm.users.create({
        data: { id: "u1", name: "Alice", email: "alice@example.com" },
        $skipHooks: true,
      });

      expect(hookCalls).toBe(0);
      expect(created.name).toBe("Alice");

      await orm.$raw.close();
    });
  });
});

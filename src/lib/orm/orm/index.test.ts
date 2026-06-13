import { describe, expect, test } from "bun:test";
import { date, enumType, string, uuid } from "../column/index.js";
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

const createUsersOrm = () =>
  createOrm({
    adapter: "sqlite",
    url: ":memory:",
    tables: { users: usersTable },
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

describe("relation helpers", () => {
  test("many() returns a hasMany descriptor", () => {
    const relation = many(() => postsTable);

    expect(relation._type).toBe("hasMany");
    expect(relation._table).toBe(postsTable);
  });

  test("one() returns a hasOne descriptor", () => {
    const relation = one("userId", () => usersTable);

    expect(relation._type).toBe("hasOne");
    expect(relation._table).toBe(usersTable);
    expect(relation._foreignKey).toBe("userId");
  });

  test("one() foreign key must be a column on the source table", async () => {
    const profilesTable = defineTable("profiles", {
      id: uuid("id").primaryKey().notNull(),
      userId: uuid("user_id").notNull(),
    });

    const ormA = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable, profiles: profilesTable },
      relations: {
        profiles: {
          user: one("userId", () => usersTable),
        },
      },
    });

    const ormB = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: { users: usersTable, profiles: profilesTable },
      relations: {
        profiles: {
          // @ts-expect-error "badKey" is not a column on profilesTable
          user: one("badKey", () => usersTable),
        },
      },
    });

    await ormA.$raw.close();
    await ormB.$raw.close();
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

  test("enumType enforces literal values and equals-only where operators", async () => {
    const table = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      status: enumType("status", ["active", "inactive"]).notNull(),
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
        id: "user-1",
        status: "active",
      },
    });

    const invalidCreate: Parameters<typeof orm.users.create>[0] = {
      data: {
        id: "user-1",
        // @ts-expect-error status only accepts active or inactive
        status: "pending",
      },
    };

    expect(invalidCreate).toBeDefined();

    const invalidWhereValue: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        // @ts-expect-error status only accepts active or inactive
        status: "pending",
      },
    };

    expect(invalidWhereValue).toBeDefined();

    const invalidWhereOperator: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        status: {
          // @ts-expect-error enumType supports equals only
          startsWith: "a",
        },
      },
    };

    expect(invalidWhereOperator).toBeDefined();

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

describe("nested include options", () => {
  const authoredPostsTable = defineTable("posts", {
    id: uuid("id").primaryKey().notNull(),
    title: string("title").notNull(),
    content: string("content").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.columns.id),
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
    defineTable(sqlName, {
      id: uuid("id").primaryKey().notNull(),
      title: string("title").notNull(),
      userId: uuid("user_id")
        .notNull()
        .references(() => usersTable.columns.id),
    });

  const definePostWithAuthorAndContentTable = (sqlName: string) =>
    defineTable(sqlName, {
      id: uuid("id").primaryKey().notNull(),
      title: string("title").notNull(),
      content: string("content").notNull(),
      userId: uuid("user_id")
        .notNull()
        .references(() => usersTable.columns.id),
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

  test("nested include select rejects invalid column names", async () => {
    const orm = createOrmWithPosts();

    const _invalid: Parameters<typeof orm.users.findMany>[0] = {
      include: {
        posts: {
          select: {
            // @ts-expect-error "nonExistent" is not a column on posts
            nonExistent: true,
          },
        },
      },
    };

    expect(_invalid).toBeDefined();
    await orm.$raw.close();
  });

  test("nested include options accept valid types and reject invalid ones", async () => {
    const orm = createOrmWithPosts();

    const _valid: Parameters<typeof orm.users.findMany>[0] = {
      include: {
        posts: {
          where: { title: "Hello" },
          orderBy: { title: "asc" },
          take: 5,
          skip: 0,
          select: { id: true, title: true },
        },
      },
    };

    const _invalidWhere: Parameters<typeof orm.users.findMany>[0] = {
      include: {
        posts: {
          where: {
            // @ts-expect-error "badCol" is not a column on posts
            badCol: "x",
          },
        },
      },
    };

    const _invalidOrderDir: Parameters<typeof orm.users.findMany>[0] = {
      include: {
        posts: {
          orderBy: {
            // @ts-expect-error invalid direction
            title: "badDir",
          },
        },
      },
    };

    expect(_valid).toBeDefined();
    expect(_invalidWhere).toBeDefined();
    expect(_invalidOrderDir).toBeDefined();
    await orm.$raw.close();
  });

  test("nested include propagates relation types (posts include author)", async () => {
    const postsWithAuthorTable = definePostWithAuthorTable("posts_with_author");
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

    // runtime: nested include data is present
    expect(author?.name).toBe("John");

    // type: author column is accessible (TypeScript would flag unknown columns)
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

  test("select on depth-3 nested include narrows type correctly", async () => {
    const postsWithAuthorTable = definePostWithAuthorAndContentTable(
      "posts_select_depth3",
    );
    const orm = createOrmWithAuthorRelation(postsWithAuthorTable);

    // "author.posts" with select — type must only contain selected columns.
    // Before the fix, the intersection `TIncludeValue & { select?: TableSelect<T> }`
    // added all optional columns, so keyof picked up id, title, content, userId.
    const _typed: Parameters<typeof orm.users.findMany>[0] = {
      include: {
        posts: {
          include: {
            author: {
              include: {
                posts: { select: { title: true, content: true } },
              },
            },
          },
        },
      },
    };

    type AuthorPosts = NonNullable<
      ReturnType<typeof orm.users.findMany> extends Promise<infer U>
        ? U extends Array<infer Row>
          ? Row extends { posts: Array<infer Post> }
            ? Post extends { author: infer Author | null }
              ? Author extends { posts: Array<infer AuthorPost> }
                ? AuthorPost
                : never
              : never
            : never
          : never
        : never
    >;

    // AuthorPosts should only have title and content, not id or userId.
    // @ts-expect-error id should not exist when select: { title, content }
    const _badId: AuthorPosts = { id: "", title: "", content: "" };

    expect(_typed).toBeDefined();
    expect(_badId).toBeDefined();
    await orm.$raw.close();
  });

  test("nested include with select does not produce never in sibling relation type", async () => {
    const postsWithAuthorTable = definePostWithAuthorTable("posts_never_check");
    const orm = createOrmWithAuthorRelation(postsWithAuthorTable);

    // "author" appears in type (depth 2) — must be a proper type, not never
    const _check: Parameters<typeof orm.users.findMany>[0] = {
      include: {
        posts: {
          include: {
            author: {
              // author.posts is depth 3 — no type info but MUST NOT produce `posts: never`
              include: { posts: { select: { title: true } } },
            },
          },
        },
      },
    };

    expect(_check).toBeDefined();
    await orm.$raw.close();
  });

  test("nested include type rejects invalid columns at each level", async () => {
    const postsWithAuthorTable = definePostWithAuthorTable(
      "posts_nested_type_check",
    );
    const orm = createOrmWithAuthorRelation(postsWithAuthorTable);

    // valid: include author (a known relation on posts)
    const _valid: Parameters<typeof orm.users.findMany>[0] = {
      include: { posts: { include: { author: true } } },
    };

    // invalid: "badCol" in nested where is not a column on posts
    const _invalidNestedWhere: Parameters<typeof orm.users.findMany>[0] = {
      include: {
        posts: {
          where: {
            // @ts-expect-error "badCol" is not a column on posts
            badCol: "x",
          },
        },
      },
    };

    expect(_valid).toBeDefined();
    expect(_invalidNestedWhere).toBeDefined();
    await orm.$raw.close();
  });

  test("deep bidirectional include matches runtime and inferred type", async () => {
    const exampleUsersTable = defineTable("users", {
      id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
      firstName: string("first_name").notNull(),
      lastName: string("last_name").notNull(),
    });

    const examplePostsTable = defineTable("posts", {
      id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
      title: string("title").notNull(),
      content: string("content").notNull(),
      authorId: uuid("author_id")
        .notNull()
        .references(() => exampleUsersTable.columns.id),
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
    const studentTable = defineTable("students", {
      id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
      createdAt: date("created_at")
        .notNull()
        .default(() => new Date()),
      updatedAt: date("updated_at")
        .notNull()
        .default(() => new Date()),
      firstName: string("first_name").notNull(),
      lastName: string("last_name").notNull(),
    });

    const examsTable = defineTable("exams", {
      id: uuid("id").primaryKey().notNull().default(Bun.randomUUIDv7),
      createdAt: date("created_at")
        .notNull()
        .default(() => new Date()),
      updatedAt: date("updated_at")
        .notNull()
        .default(() => new Date()),
      name: string("name").notNull(),
    });

    const studentsToExamsTable = defineTable("students_to_exams", {
      studentId: uuid("student_id")
        .primaryKey()
        .notNull()
        .references(() => studentTable.columns.id),
      examId: uuid("exam_id")
        .primaryKey()
        .notNull()
        .references(() => examsTable.columns.id),
    });

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

    // Define tables and releations

    await orm.$raw`PRAGMA foreign_keys = ON;`;
    await orm.$raw`PRAGMA foreign_keys;`;
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

    // Save data

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

    // Read data

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
    const studentTable = defineTable("students", {
      id: uuid("id").primaryKey().notNull(),
      firstName: string("first_name").notNull(),
    });

    const examsTable = defineTable("exams", {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    });

    const studentsToExamsTable = defineTable("students_to_exams", {
      studentId: uuid("student_id")
        .primaryKey()
        .notNull()
        .references(() => studentTable.columns.id),
      examId: uuid("exam_id")
        .primaryKey()
        .notNull()
        .references(() => examsTable.columns.id),
    });

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

    await orm.students.createMany({ data: [{ id: "S1", firstName: "John" }] });
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

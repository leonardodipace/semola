import { describe, expect, test } from "bun:test";
import { boolean, enumType, number, string, uuid } from "../column/index.js";
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
        $or: [{ email: { endsWith: "@example.com" } }, { name: "Jane" }],
        $not: { name: "Blocked" },
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
          // @ts-expect-error enumType supports equals, in, and notIn only
          startsWith: "a",
        },
      },
    };

    expect(invalidWhereOperator).toBeDefined();

    const invalidBetweenOnEnum: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        status: {
          // @ts-expect-error enumType does not support between
          between: ["active", "inactive"],
        },
      },
    };

    expect(invalidBetweenOnEnum).toBeDefined();

    acceptCreateOptions<Parameters<typeof orm.users.findMany>[0]>({
      where: {
        status: { in: ["active", "inactive"] },
      },
    });

    acceptCreateOptions<Parameters<typeof orm.users.findMany>[0]>({
      where: {
        status: { notIn: ["inactive"] },
      },
    });

    const invalidInValue: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        status: {
          in: [
            // @ts-expect-error status only accepts active or inactive
            "pending",
          ],
        },
      },
    };

    expect(invalidInValue).toBeDefined();

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
});

describe("relation where filters", () => {
  const postsTable = defineTable("posts", {
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

  test("relation where filters are typed on findMany", async () => {
    const orm = createOrmWithPosts();

    const valid: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        posts: { none: { published: false } },
      },
    };

    const validBetween: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        posts: { some: { views: { between: [100, 500] } } },
      },
    };

    const invalidRelation: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        // @ts-expect-error tasks is not a relation on users
        tasks: { some: {} },
      },
    };

    const invalidFilter: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        posts: {
          // @ts-expect-error views is not a column on users
          views: { gt: 1 },
        },
      },
    };

    const invalidBetweenValue: Parameters<typeof orm.users.findMany>[0] = {
      where: {
        posts: {
          some: {
            views: {
              between: [
                // @ts-expect-error views is a number column
                "100",
                500,
              ],
            },
          },
        },
      },
    };

    expect(valid).toBeDefined();
    expect(validBetween).toBeDefined();
    expect(invalidRelation).toBeDefined();
    expect(invalidFilter).toBeDefined();
    expect(invalidBetweenValue).toBeDefined();

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
      where: {
        $and: [{ name: { contains: "Jo" } }],
      },
      include: {
        posts: {
          where: {
            $or: [{ title: "Hello" }, { content: { contains: "World" } }],
          },
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
            $or: [
              {
                // @ts-expect-error "badCol" is not a column on posts
                badCol: "x",
              },
            ],
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
});

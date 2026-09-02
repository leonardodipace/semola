import { describe, expect, test } from "bun:test";
import { mightThrow } from "../../errors/index.js";
import { string, uuid } from "../column/index.js";
import { integrationAdapters } from "../integration-helpers.js";
import { defineTable } from "../table/index.js";
import { createOrm, many, one } from "./index.js";

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
    authorId: uuid("author_id").references(() => usersTable.columns.id),
  },
});

const profilesTable = defineTable({
  sqlName: "profiles",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    bio: string("bio").notNull(),
  },
});

const usersWithProfileTable = defineTable({
  sqlName: "users_with_profile",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    email: string("email").notNull().unique(),
    profileId: uuid("profile_id").references(() => profilesTable.columns.id),
  },
});

const schemaSql = {
  sqlite: {
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)",
    posts:
      "CREATE TABLE posts (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, author_id TEXT)",
    profiles:
      "CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, bio TEXT NOT NULL)",
    usersWithProfile:
      "CREATE TABLE users_with_profile (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, profile_id TEXT)",
  },
  postgres: {
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)",
    posts:
      "CREATE TABLE posts (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, author_id TEXT)",
    profiles:
      "CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, bio TEXT NOT NULL)",
    usersWithProfile:
      "CREATE TABLE users_with_profile (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, profile_id TEXT)",
  },
} as const;

for (const live of integrationAdapters()) {
  describe(`${live.adapter} mutation connect and disconnect`, () => {
    const ddl = schemaSql[live.adapter];

    const open = async () => {
      await live.beforeEach?.();

      const orm = createOrm({
        adapter: live.adapter,
        url: live.url,
        tables: {
          users: usersTable,
          posts: postsTable,
          profiles: profilesTable,
          usersWithProfile: usersWithProfileTable,
        },
        relations: {
          users: { posts: many(() => postsTable) },
          posts: { author: one("authorId", () => usersTable) },
          usersWithProfile: {
            profile: one("profileId", () => profilesTable),
          },
        },
      });

      await orm.$raw.unsafe(ddl.users);
      await orm.$raw.unsafe(ddl.posts);
      await orm.$raw.unsafe(ddl.profiles);
      await orm.$raw.unsafe(ddl.usersWithProfile);

      return orm;
    };

    test("hasOne connect by id on create", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: "u1", name: "Ada", email: "ada@example.com" },
      });
      await orm.posts.create({
        data: {
          id: "p1",
          title: "Draft",
          author: { connect: { id: "u1" } },
        },
      });

      const post = await orm.posts.findUnique({
        where: { id: "p1" },
        include: { author: true },
      });

      expect(post?.authorId).toBe("u1");
      expect(post?.author?.email).toBe("ada@example.com");

      await orm.$raw.close();
    });

    test("hasOne connect by unique field on update", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: "u1", name: "Ada", email: "ada@example.com" },
      });
      await orm.posts.create({
        data: { id: "p1", title: "Draft" },
      });

      await orm.posts.update({
        where: { id: "p1" },
        data: {
          author: { connect: { email: "ada@example.com" } },
        },
      });

      const post = await orm.posts.findUnique({ where: { id: "p1" } });

      expect(post?.authorId).toBe("u1");

      await orm.$raw.close();
    });

    test("hasMany connect on create and update", async () => {
      const orm = await open();

      await orm.posts.create({
        data: { id: "p1", title: "First" },
      });
      await orm.posts.create({
        data: { id: "p2", title: "Second" },
      });
      await orm.posts.create({
        data: { id: "p3", title: "Third" },
      });

      const user = await orm.users.create({
        data: {
          id: "u1",
          name: "Ada",
          email: "ada@example.com",
          posts: { connect: [{ id: "p1" }, { id: "p2" }] },
        },
        include: { posts: true },
      });

      expect(user.posts).toHaveLength(2);

      await orm.users.update({
        where: { id: "u1" },
        data: {
          posts: { connect: [{ id: "p3" }] },
        },
      });

      const posts = await orm.posts.findMany({
        where: { authorId: "u1" },
        orderBy: { title: "asc" },
      });

      expect(posts).toHaveLength(3);

      await orm.$raw.close();
    });

    test("hasOne and hasMany disconnect on optional relations", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: "prof1", bio: "Hello" },
      });
      await orm.usersWithProfile.create({
        data: {
          id: "u1",
          email: "ada@example.com",
          profile: { connect: { id: "prof1" } },
        },
      });
      await orm.users.create({
        data: { id: "u2", name: "Grace", email: "grace@example.com" },
      });
      await orm.posts.create({
        data: {
          id: "p1",
          title: "Linked",
          author: { connect: { id: "u2" } },
        },
      });

      await orm.usersWithProfile.update({
        where: { id: "u1" },
        data: {
          profile: { disconnect: true },
        },
      });
      await orm.posts.update({
        where: { id: "p1" },
        data: {
          author: { disconnect: true },
        },
      });

      const user = await orm.usersWithProfile.findUnique({
        where: { id: "u1" },
      });
      const post = await orm.posts.findUnique({ where: { id: "p1" } });

      expect(user?.profileId).toBeNull();
      expect(post?.authorId).toBeNull();

      await orm.$raw.close();
    });

    test("hasMany disconnect selected posts", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: "u1", name: "Ada", email: "ada@example.com" },
      });
      await orm.posts.create({
        data: {
          id: "p1",
          title: "Keep",
          author: { connect: { id: "u1" } },
        },
      });
      await orm.posts.create({
        data: {
          id: "p2",
          title: "Drop",
          author: { connect: { id: "u1" } },
        },
      });

      await orm.users.update({
        where: { id: "u1" },
        data: {
          posts: { disconnect: [{ id: "p2" }] },
        },
      });

      const kept = await orm.posts.findUnique({ where: { id: "p1" } });
      const dropped = await orm.posts.findUnique({ where: { id: "p2" } });

      expect(kept?.authorId).toBe("u1");
      expect(dropped?.authorId).toBeNull();

      await orm.$raw.close();
    });

    test("connect fails when related record does not exist", async () => {
      const orm = await open();

      const [error] = await mightThrow(
        orm.posts.create({
          data: {
            id: "p1",
            title: "Draft",
            author: { connect: { id: "missing-user" } },
          },
        }),
      );

      expect(error?.message).toContain("Record to connect not found");
      expect(await orm.posts.findUnique({ where: { id: "p1" } })).toBeNull();

      await orm.$raw.close();
    });

    test("nested relation writes roll back atomically", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: "u1", name: "Ada", email: "ada@example.com" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: {
            id: "u2",
            name: "Grace",
            email: "grace@example.com",
            posts: { connect: [{ id: "missing-post" }] },
          },
        }),
      );

      expect(error?.message).toContain("Record to connect not found");
      expect(await orm.users.findUnique({ where: { id: "u2" } })).toBeNull();

      await orm.$raw.close();
    });
  });
}

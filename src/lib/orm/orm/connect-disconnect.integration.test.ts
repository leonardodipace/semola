import { describe, expect, test } from "bun:test";
import { mightThrow } from "../../errors/index.js";
import { string, uuid } from "../column/index.js";
import {
  integrationAdapters,
  PG_ID,
  PG_ID_2,
  PG_ID_3,
} from "../integration-helpers.js";
import { defineTable } from "../table/index.js";
import { createOrm, many, one } from "./index.js";
import type { CreateData, UpdateData } from "./types.js";

const profilesTable = defineTable({
  sqlName: "profiles",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    bio: string("bio").notNull(),
  },
});

const usersTable = defineTable({
  sqlName: "users",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    email: string("email").notNull().unique(),
    profileId: uuid("profile_id").references(() => profilesTable.columns.id),
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

const schemaSql = {
  sqlite: {
    profiles: "CREATE TABLE profiles (id TEXT PRIMARY KEY, bio TEXT NOT NULL)",
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, profile_id TEXT)",
    posts:
      "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, author_id TEXT)",
  },
  postgres: {
    profiles: "CREATE TABLE profiles (id TEXT PRIMARY KEY, bio TEXT NOT NULL)",
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, profile_id TEXT)",
    posts:
      "CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, author_id TEXT)",
  },
} as const;

type ConnectByUnique<TUnique extends Record<string, unknown>> = {
  connect: TUnique;
};

type UserCreateMutationData = CreateData<typeof usersTable> & {
  profile?: ConnectByUnique<{ id: string }>;
  posts?: { connect: Array<{ id: string }> };
};

type UserUpdateMutationData = UpdateData<typeof usersTable> & {
  profile?: ConnectByUnique<{ id: string }> | { disconnect: true };
};

type PostCreateMutationData = CreateData<typeof postsTable> & {
  author?: ConnectByUnique<{ id: string } | { email: string }>;
};

type PostUpdateMutationData = UpdateData<typeof postsTable> & {
  author?: { disconnect: true };
};

const userCreateData = (data: UserCreateMutationData) =>
  data as CreateData<typeof usersTable>;

const userUpdateData = (data: UserUpdateMutationData) =>
  data as UpdateData<typeof usersTable>;

const postCreateData = (data: PostCreateMutationData) =>
  data as CreateData<typeof postsTable>;

const postUpdateData = (data: PostUpdateMutationData) =>
  data as UpdateData<typeof postsTable>;

for (const live of integrationAdapters()) {
  describe(`${live.adapter} connect and disconnect mutations`, () => {
    const ddl = schemaSql[live.adapter];
    const userId = live.adapter === "postgres" ? PG_ID : "u1";
    const profileId = live.adapter === "postgres" ? PG_ID_2 : "p1";
    const postId = live.adapter === "postgres" ? PG_ID_3 : "post-1";
    const postId2 = live.adapter === "postgres" ? PG_ID_2 : "post-2";

    const open = async () => {
      await live.beforeEach?.();

      const orm = createOrm({
        adapter: live.adapter,
        url: live.url,
        tables: {
          users: usersTable,
          profiles: profilesTable,
          posts: postsTable,
        },
        relations: {
          users: {
            profile: one("profileId", () => profilesTable),
            posts: many(() => postsTable),
          },
          posts: {
            author: one("authorId", () => usersTable),
          },
        },
      });

      await orm.$raw.unsafe(ddl.profiles);
      await orm.$raw.unsafe(ddl.users);
      await orm.$raw.unsafe(ddl.posts);

      return orm;
    };

    test("connects an existing profile by id on create", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Hello" },
      });

      const created = await orm.users.create({
        data: userCreateData({
          id: userId,
          email: "alice@example.com",
          profile: {
            connect: { id: profileId },
          },
        }),
      });

      expect(created.profileId).toBe(profileId);

      const withProfile = await orm.users.findUnique({
        where: { id: userId },
        include: { profile: true },
      });

      expect(withProfile?.profile?.id).toBe(profileId);
      expect(
        await orm.profiles.findUnique({ where: { id: profileId } }),
      ).toEqual({ id: profileId, bio: "Hello" });

      await orm.$raw.close();
    });

    test("connects an existing author by unique email on create", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "ada@example.com" },
      });

      const created = await orm.posts.create({
        data: postCreateData({
          id: postId,
          title: "First post",
          author: {
            connect: { email: "ada@example.com" },
          },
        }),
      });

      expect(created.authorId).toBe(userId);

      const withAuthor = await orm.posts.findUnique({
        where: { id: postId },
        include: { author: true },
      });

      expect(withAuthor?.author?.email).toBe("ada@example.com");

      await orm.$raw.close();
    });

    test("connects an existing profile by id on update", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio A" },
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });

      const updated = await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          profile: {
            connect: { id: profileId },
          },
        }),
      });

      expect(updated.profileId).toBe(profileId);

      const withProfile = await orm.users.findUnique({
        where: { id: userId },
        include: { profile: true },
      });

      expect(withProfile?.profile?.bio).toBe("Bio A");

      await orm.$raw.close();
    });

    test("connects existing posts by id on user create", async () => {
      const orm = await open();

      await orm.posts.createMany({
        data: [
          { id: postId, title: "Draft A" },
          { id: postId2, title: "Draft B" },
        ],
      });

      await orm.users.create({
        data: userCreateData({
          id: userId,
          email: "owner@example.com",
          posts: {
            connect: [{ id: postId }, { id: postId2 }],
          },
        }),
      });

      const posts = await orm.posts.findMany({
        where: { authorId: userId },
        orderBy: { title: "asc" },
      });

      expect(posts).toHaveLength(2);
      expect(posts[0]?.id).toBe(postId);
      expect(posts[1]?.id).toBe(postId2);

      await orm.$raw.close();
    });

    test("disconnect removes the relation link but keeps the related row", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Still here" },
      });
      await orm.users.create({
        data: {
          id: userId,
          email: "alice@example.com",
          profileId,
        },
      });

      const updated = await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          profile: {
            disconnect: true,
          },
        }),
      });

      expect(updated.profileId).toBeNull();

      const user = await orm.users.findUnique({
        where: { id: userId },
        include: { profile: true },
      });

      expect(user?.profile).toBeNull();
      expect(
        await orm.profiles.findUnique({ where: { id: profileId } }),
      ).toEqual({ id: profileId, bio: "Still here" });

      await orm.$raw.close();
    });

    test("disconnect clears a post author link without deleting the user", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "ada@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Linked", authorId: userId },
      });

      const updated = await orm.posts.update({
        where: { id: postId },
        data: postUpdateData({
          author: {
            disconnect: true,
          },
        }),
      });

      expect(updated.authorId).toBeNull();
      expect(
        await orm.users.findUnique({ where: { id: userId } }),
      ).not.toBeNull();

      await orm.$raw.close();
    });

    test("rejects connect when the related record does not exist", async () => {
      const orm = await open();

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profile: {
              connect: { id: "missing-profile" },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects connect when the unique key does not match any row", async () => {
      const orm = await open();

      const [error] = await mightThrow(
        orm.posts.create({
          data: postCreateData({
            id: postId,
            title: "Orphan",
            author: {
              connect: { email: "nobody@example.com" },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.posts.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rolls back the whole create when a nested connect fails", async () => {
      const orm = await open();

      await orm.posts.create({
        data: { id: postId, title: "Draft" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            posts: {
              connect: [{ id: postId }, { id: "missing-post" }],
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findUnique({ where: { id: userId } })).toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBeNull();

      await orm.$raw.close();
    });

    test("rolls back update when connect targets a missing profile", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            email: "alice.updated@example.com",
            profile: {
              connect: { id: "missing-profile" },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();

      const user = await orm.users.findUnique({ where: { id: userId } });

      expect(user?.email).toBe("alice@example.com");
      expect(user?.profileId).toBeNull();

      await orm.$raw.close();
    });
  });
}

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

const PG_ID_4 = "44444444-4444-4444-4444-444444444444";
const PG_ID_5 = "55555555-5555-5555-5555-555555555555";
const PG_ID_6 = "66666666-6666-6666-6666-666666666666";

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
  posts?:
    | { connect: Array<{ id: string }> }
    | { disconnect: Array<{ id: string }> };
};

type PostCreateMutationData = CreateData<typeof postsTable> & {
  author?: ConnectByUnique<{ id: string } | { email: string }>;
};

type PostUpdateMutationData = UpdateData<typeof postsTable> & {
  author?:
    | ConnectByUnique<{ id: string } | { email: string }>
    | { disconnect: true };
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
  describe(`${live.adapter} connect and disconnect adversarial mutations`, () => {
    const ddl = schemaSql[live.adapter];
    const userId = live.adapter === "postgres" ? PG_ID : "u1";
    const userId2 = live.adapter === "postgres" ? PG_ID_2 : "u2";
    const profileId = live.adapter === "postgres" ? PG_ID_3 : "p1";
    const profileId2 = live.adapter === "postgres" ? PG_ID_4 : "p2";
    const postId = live.adapter === "postgres" ? PG_ID_4 : "post-1";
    const postId2 = live.adapter === "postgres" ? PG_ID_5 : "post-2";
    const postId3 = live.adapter === "postgres" ? PG_ID_6 : "post-3";
    const missingId = live.adapter === "postgres" ? PG_ID_5 : "missing-id";

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

    test("rejects nested create operator on to-one relation", async () => {
      const orm = await open();

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profile: {
              create: { id: profileId, bio: "New" },
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects nested link operator on relation during update", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            profile: {
              link: { id: profileId },
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();

      const user = await orm.users.findUnique({ where: { id: userId } });

      expect(user?.profileId).toBeNull();

      await orm.$raw.close();
    });

    test("rejects nested set operator on to-many relation", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              set: [{ id: postId }],
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();

      await orm.$raw.close();
    });

    test("rejects connectOrCreate operator on relation", async () => {
      const orm = await open();

      const [error] = await mightThrow(
        orm.posts.create({
          data: postCreateData({
            id: postId,
            title: "Draft",
            author: {
              connectOrCreate: {
                where: { email: "new@example.com" },
                create: { id: userId, email: "new@example.com" },
              },
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.posts.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects disconnect true on to-many relation", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Linked", authorId: userId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              disconnect: true,
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBe(userId);

      await orm.$raw.close();
    });

    test("rejects connect array shape on to-one relation", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profile: {
              connect: [{ id: profileId }],
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects empty connect object on to-one relation", async () => {
      const orm = await open();

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profile: {
              connect: {},
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects connect using non-unique column as lookup key", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profile: {
              connect: { bio: "Bio" },
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects connect with multiple lookup fields", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profile: {
              connect: { id: profileId, bio: "Bio" },
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects disconnect false on optional to-one relation", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com", profileId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            profile: {
              disconnect: false,
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();

      const user = await orm.users.findUnique({ where: { id: userId } });

      expect(user?.profileId).toBe(profileId);

      await orm.$raw.close();
    });

    test("connects orphan posts on user update", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.createMany({
        data: [
          { id: postId, title: "Draft A" },
          { id: postId2, title: "Draft B" },
        ],
      });

      await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
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

    test("disconnects specific posts on user update without deleting rows", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.createMany({
        data: [
          { id: postId, title: "Keep", authorId: userId },
          { id: postId2, title: "Remove", authorId: userId },
        ],
      });

      await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          posts: {
            disconnect: [{ id: postId2 }],
          },
        }),
      });

      const kept = await orm.posts.findUnique({ where: { id: postId } });
      const removed = await orm.posts.findUnique({ where: { id: postId2 } });

      expect(kept?.authorId).toBe(userId);
      expect(removed?.authorId).toBeNull();
      expect(removed?.title).toBe("Remove");

      await orm.$raw.close();
    });

    test("disconnect subset leaves other post links intact", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.createMany({
        data: [
          { id: postId, title: "A", authorId: userId },
          { id: postId2, title: "B", authorId: userId },
          { id: postId3, title: "C", authorId: userId },
        ],
      });

      await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          posts: {
            disconnect: [{ id: postId2 }],
          },
        }),
      });

      const posts = await orm.posts.findMany({
        where: { authorId: userId },
        orderBy: { title: "asc" },
      });

      expect(posts).toHaveLength(2);
      expect(posts[0]?.id).toBe(postId);
      expect(posts[1]?.id).toBe(postId3);

      await orm.$raw.close();
    });

    test("rolls back update when to-many disconnect targets missing post", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Linked", authorId: userId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            email: "owner.updated@example.com",
            posts: {
              disconnect: [{ id: postId }, { id: missingId }],
            },
          }),
        }),
      );

      expect(error).not.toBeNull();

      const user = await orm.users.findUnique({ where: { id: userId } });
      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(user?.email).toBe("owner@example.com");
      expect(post?.authorId).toBe(userId);

      await orm.$raw.close();
    });

    test("rolls back update when disconnect references post not linked to user", async () => {
      const orm = await open();

      await orm.users.createMany({
        data: [
          { id: userId, email: "owner@example.com" },
          { id: userId2, email: "other@example.com" },
        ],
      });
      await orm.posts.create({
        data: { id: postId, title: "Other user post", authorId: userId2 },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              disconnect: [{ id: postId }],
            },
          }),
        }),
      );

      expect(error).not.toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBe(userId2);

      await orm.$raw.close();
    });

    test("rolls back create when connecting post already linked to another user", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Taken", authorId: userId },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId2,
            email: "rival@example.com",
            posts: {
              connect: [{ id: postId }],
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findUnique({ where: { id: userId2 } })).toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBe(userId);

      await orm.$raw.close();
    });

    test("rolls back update when connecting post already owned by another user", async () => {
      const orm = await open();

      await orm.users.createMany({
        data: [
          { id: userId, email: "owner@example.com" },
          { id: userId2, email: "rival@example.com" },
        ],
      });
      await orm.posts.create({
        data: { id: postId, title: "Taken", authorId: userId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId2 },
          data: userUpdateData({
            posts: {
              connect: [{ id: postId }],
            },
          }),
        }),
      );

      expect(error).not.toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBe(userId);

      await orm.$raw.close();
    });

    test("applies scalar update and successful connect atomically", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });

      const updated = await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          email: "alice.updated@example.com",
          profile: {
            connect: { id: profileId },
          },
        }),
      });

      expect(updated.email).toBe("alice.updated@example.com");
      expect(updated.profileId).toBe(profileId);

      await orm.$raw.close();
    });

    test("rolls back scalar and prior link when late connect in array fails", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Draft", authorId: userId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            email: "owner.updated@example.com",
            posts: {
              connect: [{ id: postId }, { id: missingId }],
            },
          }),
        }),
      );

      expect(error).not.toBeNull();

      const user = await orm.users.findUnique({ where: { id: userId } });
      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(user?.email).toBe("owner@example.com");
      expect(post?.authorId).toBe(userId);

      await orm.$raw.close();
    });

    test("swaps profile via disconnect and connect in same update", async () => {
      const orm = await open();

      await orm.profiles.createMany({
        data: [
          { id: profileId, bio: "Old" },
          { id: profileId2, bio: "New" },
        ],
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com", profileId },
      });

      await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          profile: {
            disconnect: true,
          },
        }),
      });

      const swapped = await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          profile: {
            connect: { id: profileId2 },
          },
        }),
      });

      expect(swapped.profileId).toBe(profileId2);

      const withProfile = await orm.users.findUnique({
        where: { id: userId },
        include: { profile: true },
      });

      expect(withProfile?.profile?.bio).toBe("New");
      expect(
        await orm.profiles.findUnique({ where: { id: profileId } }),
      ).not.toBeNull();

      await orm.$raw.close();
    });

    test("rejects create with both direct profileId and nested profile connect", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profileId,
            profile: {
              connect: { id: profileId },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("rejects update with conflicting direct profileId and nested connect", async () => {
      const orm = await open();

      await orm.profiles.createMany({
        data: [
          { id: profileId, bio: "A" },
          { id: profileId2, bio: "B" },
        ],
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            profileId: profileId,
            profile: {
              connect: { id: profileId2 },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();

      const user = await orm.users.findUnique({ where: { id: userId } });

      expect(user?.profileId).toBeNull();

      await orm.$raw.close();
    });

    test("leaves user without posts when empty connect array is provided", async () => {
      const orm = await open();

      await orm.users.create({
        data: userCreateData({
          id: userId,
          email: "owner@example.com",
          posts: {
            connect: [],
          },
        }),
      });

      const posts = await orm.posts.findMany({
        where: { authorId: userId },
      });

      expect(posts).toHaveLength(0);

      await orm.$raw.close();
    });

    test("connects duplicate post ids in array without duplicating link", async () => {
      const orm = await open();

      await orm.posts.create({
        data: { id: postId, title: "Draft" },
      });

      await orm.users.create({
        data: userCreateData({
          id: userId,
          email: "owner@example.com",
          posts: {
            connect: [{ id: postId }, { id: postId }],
          },
        }),
      });

      const posts = await orm.posts.findMany({
        where: { authorId: userId },
      });

      expect(posts).toHaveLength(1);
      expect(posts[0]?.id).toBe(postId);

      await orm.$raw.close();
    });

    test("reconnecting same profile on update keeps the link", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com", profileId },
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

      await orm.$raw.close();
    });

    test("reconnecting already linked post on update keeps single ownership", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Linked", authorId: userId },
      });

      await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          posts: {
            connect: [{ id: postId }],
          },
        }),
      });

      const posts = await orm.posts.findMany({
        where: { authorId: userId },
      });

      expect(posts).toHaveLength(1);
      expect(posts[0]?.id).toBe(postId);

      await orm.$raw.close();
    });

    test("rejects connect with null lookup value", async () => {
      const orm = await open();

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "alice@example.com",
            profile: {
              connect: { id: null as never },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("connects to-one and to-many relations in one create", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });
      await orm.posts.createMany({
        data: [
          { id: postId, title: "A" },
          { id: postId2, title: "B" },
        ],
      });

      const created = await orm.users.create({
        data: userCreateData({
          id: userId,
          email: "owner@example.com",
          profile: {
            connect: { id: profileId },
          },
          posts: {
            connect: [{ id: postId }, { id: postId2 }],
          },
        }),
      });

      expect(created.profileId).toBe(profileId);

      const posts = await orm.posts.findMany({
        where: { authorId: userId },
        orderBy: { title: "asc" },
      });

      expect(posts).toHaveLength(2);

      await orm.$raw.close();
    });

    test("rolls back entire create when to-one connect fails after to-many would succeed", async () => {
      const orm = await open();

      await orm.posts.create({
        data: { id: postId, title: "Draft" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "owner@example.com",
            profile: {
              connect: { id: missingId },
            },
            posts: {
              connect: [{ id: postId }],
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

    test("swaps post author via disconnect then connect in same update", async () => {
      const orm = await open();

      await orm.users.createMany({
        data: [
          { id: userId, email: "old@example.com" },
          { id: userId2, email: "new@example.com" },
        ],
      });
      await orm.posts.create({
        data: { id: postId, title: "Article", authorId: userId },
      });

      await orm.posts.update({
        where: { id: postId },
        data: postUpdateData({
          author: {
            disconnect: true,
          },
        }),
      });

      const updated = await orm.posts.update({
        where: { id: postId },
        data: postUpdateData({
          author: {
            connect: { email: "new@example.com" },
          },
        }),
      });

      expect(updated.authorId).toBe(userId2);

      await orm.$raw.close();
    });

    test("rejects nested delete operator on relation", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Linked", authorId: userId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              delete: [{ id: postId }],
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBe(userId);

      await orm.$raw.close();
    });

    test("rejects nested update operator on relation", async () => {
      const orm = await open();

      await orm.profiles.create({
        data: { id: profileId, bio: "Bio" },
      });
      await orm.users.create({
        data: { id: userId, email: "alice@example.com", profileId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            profile: {
              update: { bio: "Changed" },
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();

      const profile = await orm.profiles.findUnique({ where: { id: profileId } });

      expect(profile?.bio).toBe("Bio");

      await orm.$raw.close();
    });

    test("rejects connect on update when unique email matches no user", async () => {
      const orm = await open();

      await orm.posts.create({
        data: { id: postId, title: "Orphan" },
      });

      const [error] = await mightThrow(
        orm.posts.update({
          where: { id: postId },
          data: postUpdateData({
            author: {
              connect: { email: "ghost@example.com" },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBeNull();

      await orm.$raw.close();
    });

    test("rejects to-many disconnect with single object instead of array", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.create({
        data: { id: postId, title: "Linked", authorId: userId },
      });

      const [error] = await mightThrow(
        orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              disconnect: { id: postId },
            } as never,
          }),
        }),
      );

      expect(error).not.toBeNull();

      const post = await orm.posts.findUnique({ where: { id: postId } });

      expect(post?.authorId).toBe(userId);

      await orm.$raw.close();
    });

    test("rejects connect by id when row exists in wrong table context", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "alice@example.com" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId2,
            email: "bob@example.com",
            profile: {
              connect: { id: userId },
            },
          }),
        }),
      );

      expect(error).not.toBeNull();
      expect(await orm.users.findUnique({ where: { id: userId2 } })).toBeNull();

      await orm.$raw.close();
    });

    test("disconnect empty array leaves all links unchanged", async () => {
      const orm = await open();

      await orm.users.create({
        data: { id: userId, email: "owner@example.com" },
      });
      await orm.posts.createMany({
        data: [
          { id: postId, title: "A", authorId: userId },
          { id: postId2, title: "B", authorId: userId },
        ],
      });

      await orm.users.update({
        where: { id: userId },
        data: userUpdateData({
          posts: {
            disconnect: [],
          },
        }),
      });

      const posts = await orm.posts.findMany({
        where: { authorId: userId },
      });

      expect(posts).toHaveLength(2);

      await orm.$raw.close();
    });

    test("rolls back create when second post in connect array is missing", async () => {
      const orm = await open();

      await orm.posts.create({
        data: { id: postId, title: "Only" },
      });

      const [error] = await mightThrow(
        orm.users.create({
          data: userCreateData({
            id: userId,
            email: "owner@example.com",
            posts: {
              connect: [{ id: postId }, { id: missingId }],
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
  });
}

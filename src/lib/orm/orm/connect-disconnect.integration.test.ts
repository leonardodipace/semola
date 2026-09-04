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
const PG_ID_7 = "77777777-7777-7777-7777-777777777777";
const PG_ID_8 = "88888888-8888-8888-8888-888888888888";

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

    describe("edge cases", () => {
      const userId2 = live.adapter === "postgres" ? PG_ID_2 : "u2";
      const edgeProfileId = live.adapter === "postgres" ? PG_ID_3 : "p1";
      const edgeProfileId2 = live.adapter === "postgres" ? PG_ID_7 : "p2";
      const edgePostId = live.adapter === "postgres" ? PG_ID_4 : "post-1";
      const edgePostId2 = live.adapter === "postgres" ? PG_ID_5 : "post-2";
      const edgePostId3 = live.adapter === "postgres" ? PG_ID_6 : "post-3";
      const missingId = live.adapter === "postgres" ? PG_ID_8 : "missing-id";

      test("rejects nested create operator on to-one relation", async () => {
        const orm = await open();

        const [error] = await mightThrow(
          orm.users.create({
            data: userCreateData({
              id: userId,
              email: "alice@example.com",
              profile: {
                create: { id: edgeProfileId, bio: "New" },
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
          data: { id: edgeProfileId, bio: "Bio" },
        });
        await orm.users.create({
          data: { id: userId, email: "alice@example.com" },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              profile: {
                link: { id: edgeProfileId },
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
                set: [{ id: edgePostId }],
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
              id: edgePostId,
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
          data: { id: edgePostId, title: "Linked", authorId: userId },
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

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

        expect(post?.authorId).toBe(userId);

        await orm.$raw.close();
      });

      test("rejects connect array shape on to-one relation", async () => {
        const orm = await open();

        await orm.profiles.create({
          data: { id: edgeProfileId, bio: "Bio" },
        });

        const [error] = await mightThrow(
          orm.users.create({
            data: userCreateData({
              id: userId,
              email: "alice@example.com",
              profile: {
                connect: [{ id: edgeProfileId }],
              } as never,
            }),
          }),
        );

        expect(error).not.toBeNull();
        expect(await orm.users.findMany()).toHaveLength(0);

        await orm.$raw.close();
      });

      test("rejects connect and disconnect in the same relation write", async () => {
        const orm = await open();

        await orm.profiles.create({
          data: { id: edgeProfileId, bio: "Bio" },
        });
        await orm.users.create({
          data: {
            id: userId,
            email: "alice@example.com",
            profileId: edgeProfileId,
          },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              profile: {
                disconnect: true,
                connect: { id: edgeProfileId },
              } as never,
            }),
          }),
        );

        expect(error).not.toBeNull();

        const user = await orm.users.findUnique({ where: { id: userId } });

        expect(user?.profileId).toBe(edgeProfileId);

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
                connect: {} as { id: string },
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
          data: { id: edgeProfileId, bio: "Bio" },
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
          data: { id: edgeProfileId, bio: "Bio" },
        });

        const [error] = await mightThrow(
          orm.users.create({
            data: userCreateData({
              id: userId,
              email: "alice@example.com",
              profile: {
                connect: { id: edgeProfileId, bio: "Bio" },
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
          data: { id: edgeProfileId, bio: "Bio" },
        });
        await orm.users.create({
          data: {
            id: userId,
            email: "alice@example.com",
            profileId: edgeProfileId,
          },
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

        expect(user?.profileId).toBe(edgeProfileId);

        await orm.$raw.close();
      });

      test("connects orphan posts on user update", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.createMany({
          data: [
            { id: edgePostId, title: "Draft A" },
            { id: edgePostId2, title: "Draft B" },
          ],
        });

        await orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              connect: [{ id: edgePostId }, { id: edgePostId2 }],
            },
          }),
        });

        const posts = await orm.posts.findMany({
          where: { authorId: userId },
          orderBy: { title: "asc" },
        });

        expect(posts).toHaveLength(2);
        expect(posts[0]?.id).toBe(edgePostId);
        expect(posts[1]?.id).toBe(edgePostId2);

        await orm.$raw.close();
      });

      test("disconnects specific posts on user update without deleting rows", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.createMany({
          data: [
            { id: edgePostId, title: "Keep", authorId: userId },
            { id: edgePostId2, title: "Remove", authorId: userId },
          ],
        });

        await orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              disconnect: [{ id: edgePostId2 }],
            },
          }),
        });

        const kept = await orm.posts.findUnique({ where: { id: edgePostId } });
        const removed = await orm.posts.findUnique({
          where: { id: edgePostId2 },
        });

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
            { id: edgePostId, title: "A", authorId: userId },
            { id: edgePostId2, title: "B", authorId: userId },
            { id: edgePostId3, title: "C", authorId: userId },
          ],
        });

        await orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              disconnect: [{ id: edgePostId2 }],
            },
          }),
        });

        const posts = await orm.posts.findMany({
          where: { authorId: userId },
          orderBy: { title: "asc" },
        });

        expect(posts).toHaveLength(2);
        expect(posts[0]?.id).toBe(edgePostId);
        expect(posts[1]?.id).toBe(edgePostId3);

        await orm.$raw.close();
      });

      test("rolls back update when to-many disconnect targets missing post", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.create({
          data: { id: edgePostId, title: "Linked", authorId: userId },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              email: "owner.updated@example.com",
              posts: {
                disconnect: [{ id: edgePostId }, { id: missingId }],
              },
            }),
          }),
        );

        expect(error).not.toBeNull();

        const user = await orm.users.findUnique({ where: { id: userId } });
        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

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
          data: { id: edgePostId, title: "Other user post", authorId: userId2 },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              posts: {
                disconnect: [{ id: edgePostId }],
              },
            }),
          }),
        );

        expect(error).not.toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

        expect(post?.authorId).toBe(userId2);

        await orm.$raw.close();
      });

      test("rolls back create when connecting post already linked to another user", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.create({
          data: { id: edgePostId, title: "Taken", authorId: userId },
        });

        const [error] = await mightThrow(
          orm.users.create({
            data: userCreateData({
              id: userId2,
              email: "rival@example.com",
              posts: {
                connect: [{ id: edgePostId }],
              },
            }),
          }),
        );

        expect(error).not.toBeNull();
        expect(
          await orm.users.findUnique({ where: { id: userId2 } }),
        ).toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

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
          data: { id: edgePostId, title: "Taken", authorId: userId },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId2 },
            data: userUpdateData({
              posts: {
                connect: [{ id: edgePostId }],
              },
            }),
          }),
        );

        expect(error).not.toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

        expect(post?.authorId).toBe(userId);

        await orm.$raw.close();
      });

      test("applies scalar update and successful connect atomically", async () => {
        const orm = await open();

        await orm.profiles.create({
          data: { id: edgeProfileId, bio: "Bio" },
        });
        await orm.users.create({
          data: { id: userId, email: "alice@example.com" },
        });

        const updated = await orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            email: "alice.updated@example.com",
            profile: {
              connect: { id: edgeProfileId },
            },
          }),
        });

        expect(updated.email).toBe("alice.updated@example.com");
        expect(updated.profileId).toBe(edgeProfileId);

        await orm.$raw.close();
      });

      test("rolls back scalar and prior link when late connect in array fails", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.create({
          data: { id: edgePostId, title: "Draft", authorId: userId },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              email: "owner.updated@example.com",
              posts: {
                connect: [{ id: edgePostId }, { id: missingId }],
              },
            }),
          }),
        );

        expect(error).not.toBeNull();

        const user = await orm.users.findUnique({ where: { id: userId } });
        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

        expect(user?.email).toBe("owner@example.com");
        expect(post?.authorId).toBe(userId);

        await orm.$raw.close();
      });

      test("swaps profile via disconnect and connect in same update", async () => {
        const orm = await open();

        await orm.profiles.createMany({
          data: [
            { id: edgeProfileId, bio: "Old" },
            { id: edgeProfileId2, bio: "New" },
          ],
        });
        await orm.users.create({
          data: {
            id: userId,
            email: "alice@example.com",
            profileId: edgeProfileId,
          },
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
              connect: { id: edgeProfileId2 },
            },
          }),
        });

        expect(swapped.profileId).toBe(edgeProfileId2);

        const withProfile = await orm.users.findUnique({
          where: { id: userId },
          include: { profile: true },
        });

        expect(withProfile?.profile?.bio).toBe("New");
        expect(
          await orm.profiles.findUnique({ where: { id: edgeProfileId } }),
        ).not.toBeNull();

        await orm.$raw.close();
      });

      test("rejects create with both direct profileId and nested profile connect", async () => {
        const orm = await open();

        await orm.profiles.create({
          data: { id: edgeProfileId, bio: "Bio" },
        });

        const [error] = await mightThrow(
          orm.users.create({
            data: userCreateData({
              id: userId,
              email: "alice@example.com",
              profileId: edgeProfileId,
              profile: {
                connect: { id: edgeProfileId },
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
            { id: edgeProfileId, bio: "A" },
            { id: edgeProfileId2, bio: "B" },
          ],
        });
        await orm.users.create({
          data: { id: userId, email: "alice@example.com" },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              profileId: edgeProfileId,
              profile: {
                connect: { id: edgeProfileId2 },
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
          data: { id: edgePostId, title: "Draft" },
        });

        await orm.users.create({
          data: userCreateData({
            id: userId,
            email: "owner@example.com",
            posts: {
              connect: [{ id: edgePostId }, { id: edgePostId }],
            },
          }),
        });

        const posts = await orm.posts.findMany({
          where: { authorId: userId },
        });

        expect(posts).toHaveLength(1);
        expect(posts[0]?.id).toBe(edgePostId);

        await orm.$raw.close();
      });

      test("reconnecting same profile on update keeps the link", async () => {
        const orm = await open();

        await orm.profiles.create({
          data: { id: edgeProfileId, bio: "Bio" },
        });
        await orm.users.create({
          data: {
            id: userId,
            email: "alice@example.com",
            profileId: edgeProfileId,
          },
        });

        const updated = await orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            profile: {
              connect: { id: edgeProfileId },
            },
          }),
        });

        expect(updated.profileId).toBe(edgeProfileId);

        await orm.$raw.close();
      });

      test("reconnecting already linked post on update keeps single ownership", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.create({
          data: { id: edgePostId, title: "Linked", authorId: userId },
        });

        await orm.users.update({
          where: { id: userId },
          data: userUpdateData({
            posts: {
              connect: [{ id: edgePostId }],
            },
          }),
        });

        const posts = await orm.posts.findMany({
          where: { authorId: userId },
        });

        expect(posts).toHaveLength(1);
        expect(posts[0]?.id).toBe(edgePostId);

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
          data: { id: edgeProfileId, bio: "Bio" },
        });
        await orm.posts.createMany({
          data: [
            { id: edgePostId, title: "A" },
            { id: edgePostId2, title: "B" },
          ],
        });

        const created = await orm.users.create({
          data: userCreateData({
            id: userId,
            email: "owner@example.com",
            profile: {
              connect: { id: edgeProfileId },
            },
            posts: {
              connect: [{ id: edgePostId }, { id: edgePostId2 }],
            },
          }),
        });

        expect(created.profileId).toBe(edgeProfileId);

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
          data: { id: edgePostId, title: "Draft" },
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
                connect: [{ id: edgePostId }],
              },
            }),
          }),
        );

        expect(error).not.toBeNull();
        expect(
          await orm.users.findUnique({ where: { id: userId } }),
        ).toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

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
          data: { id: edgePostId, title: "Article", authorId: userId },
        });

        await orm.posts.update({
          where: { id: edgePostId },
          data: postUpdateData({
            author: {
              disconnect: true,
            },
          }),
        });

        const updated = await orm.posts.update({
          where: { id: edgePostId },
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
          data: { id: edgePostId, title: "Linked", authorId: userId },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              posts: {
                delete: [{ id: edgePostId }],
              } as never,
            }),
          }),
        );

        expect(error).not.toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

        expect(post?.authorId).toBe(userId);

        await orm.$raw.close();
      });

      test("rejects nested update operator on relation", async () => {
        const orm = await open();

        await orm.profiles.create({
          data: { id: edgeProfileId, bio: "Bio" },
        });
        await orm.users.create({
          data: {
            id: userId,
            email: "alice@example.com",
            profileId: edgeProfileId,
          },
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

        const profile = await orm.profiles.findUnique({
          where: { id: edgeProfileId },
        });

        expect(profile?.bio).toBe("Bio");

        await orm.$raw.close();
      });

      test("rejects connect on update when unique email matches no user", async () => {
        const orm = await open();

        await orm.posts.create({
          data: { id: edgePostId, title: "Orphan" },
        });

        const [error] = await mightThrow(
          orm.posts.update({
            where: { id: edgePostId },
            data: postUpdateData({
              author: {
                connect: { email: "ghost@example.com" },
              },
            }),
          }),
        );

        expect(error).not.toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

        expect(post?.authorId).toBeNull();

        await orm.$raw.close();
      });

      test("rejects to-many disconnect with single object instead of array", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.create({
          data: { id: edgePostId, title: "Linked", authorId: userId },
        });

        const [error] = await mightThrow(
          orm.users.update({
            where: { id: userId },
            data: userUpdateData({
              posts: {
                disconnect: { id: edgePostId },
              } as never,
            }),
          }),
        );

        expect(error).not.toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

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
        expect(
          await orm.users.findUnique({ where: { id: userId2 } }),
        ).toBeNull();

        await orm.$raw.close();
      });

      test("disconnect empty array leaves all links unchanged", async () => {
        const orm = await open();

        await orm.users.create({
          data: { id: userId, email: "owner@example.com" },
        });
        await orm.posts.createMany({
          data: [
            { id: edgePostId, title: "A", authorId: userId },
            { id: edgePostId2, title: "B", authorId: userId },
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
          data: { id: edgePostId, title: "Only" },
        });

        const [error] = await mightThrow(
          orm.users.create({
            data: userCreateData({
              id: userId,
              email: "owner@example.com",
              posts: {
                connect: [{ id: edgePostId }, { id: missingId }],
              },
            }),
          }),
        );

        expect(error).not.toBeNull();
        expect(
          await orm.users.findUnique({ where: { id: userId } }),
        ).toBeNull();

        const post = await orm.posts.findUnique({ where: { id: edgePostId } });

        expect(post?.authorId).toBeNull();

        await orm.$raw.close();
      });
    });
  });
}

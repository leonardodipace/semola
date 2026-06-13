import { boolean, date, json, jsonb, string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import type { ReturningQuery } from "./types.js";

export const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  firstName: string("first_name").notNull(),
  createdAt: date("created_at").notNull(),
  isActive: boolean("is_active")
    .notNull()
    .default(() => true),
});

export const postsTable = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => usersTable.columns.id),
});

export const eventsTable = defineTable("events", {
  id: uuid("id").primaryKey().notNull(),
  payload: json("payload").notNull(),
  meta: jsonb("meta").notNull(),
});

type UserPostMutationBuilder = {
  buildUpdate: (options: {
    where: { id: string };
    data: { firstName: string };
    include: { posts: { where: { title: string } } };
  }) => ReturningQuery;
  buildDelete: (options: {
    where: { id: string };
    include: { posts: { where: { title: string } } };
  }) => ReturningQuery;
};

export const buildUserPostMutationQueries = (
  builder: UserPostMutationBuilder,
) => {
  return {
    update: builder.buildUpdate({
      where: { id: "u-1" },
      data: { firstName: "Grace" },
      include: { posts: { where: { title: "Hello" } } },
    }),
    remove: builder.buildDelete({
      where: { id: "u-1" },
      include: { posts: { where: { title: "Hello" } } },
    }),
  };
};

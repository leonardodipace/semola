import { date, string, uuid } from "./column/index.js";
import { createOrm, many, one } from "./orm/index.js";
import { defineTable } from "./table/index.js";

const usersTable = defineTable("users", {
  id: uuid("id")
    .primaryKey()
    .notNull()
    .default(() => Bun.randomUUIDv7()),
  firstName: string("first_name").notNull(),
  lastName: string("last_name").notNull(),
  email: string("email").notNull().unique(),
  createdAt: date("created_at")
    .notNull()
    .default(() => new Date()),
});

const postsTable = defineTable("posts", {
  id: uuid("id")
    .primaryKey()
    .notNull()
    .default(() => Bun.randomUUIDv7()),
  title: string("title").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => usersTable.columns.id),
});

const orm = createOrm({
  adapter: "sqlite",
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
      author: one(() => usersTable),
    },
  },
});

console.time("create table");
await orm.$raw`
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
  )
`;
console.timeEnd("create table");

console.time("insert users");
const now = new Date();
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

await orm.$raw`
  INSERT INTO users (id, first_name, last_name, email, created_at) VALUES
  (${Bun.randomUUIDv7()}, 'John', 'Doe', 'john@example.com', ${oneHourAgo.toISOString()}),
  (${Bun.randomUUIDv7()}, 'Jane', 'Smith', 'jane@example.com', ${oneHourAgo.toISOString()}),
  (${Bun.randomUUIDv7()}, 'Bob', 'Johnson', 'bob@example.com', ${now.toISOString()}),
  (${Bun.randomUUIDv7()}, 'Alice', 'Williams', 'alice@example.com', ${now.toISOString()}),
  (${Bun.randomUUIDv7()}, 'Charlie', 'Brown', 'charlie@example.com', ${now.toISOString()})
`;
console.timeEnd("insert users");

console.time("findMany users");
const _users = await orm.users.findMany({
  include: {
    posts: true,
  },
});
console.timeEnd("findMany users");

console.time("findMany users");
const _posts = await orm.posts.findMany({
  include: {
    author: true,
  },
});
console.timeEnd("findMany users");

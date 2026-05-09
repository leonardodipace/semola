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

console.time("create tables");
await orm.$raw`
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
  )
`;

await orm.$raw`
  CREATE TABLE posts (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    author_id TEXT NOT NULL
  )
`;
console.timeEnd("create tables");

console.time("insert users");
const now = new Date();
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const johnId = Bun.randomUUIDv7();
const janeId = Bun.randomUUIDv7();
const bobId = Bun.randomUUIDv7();
const aliceId = Bun.randomUUIDv7();
const charlieId = Bun.randomUUIDv7();

await orm.$raw`
  INSERT INTO users (id, first_name, last_name, email, created_at) VALUES
  (${johnId}, 'John', 'Doe', 'john@example.com', ${oneHourAgo.toISOString()}),
  (${janeId}, 'Jane', 'Smith', 'jane@example.com', ${oneHourAgo.toISOString()}),
  (${bobId}, 'Bob', 'Johnson', 'bob@example.com', ${now.toISOString()}),
  (${aliceId}, 'Alice', 'Williams', 'alice@example.com', ${now.toISOString()}),
  (${charlieId}, 'Charlie', 'Brown', 'charlie@example.com', ${now.toISOString()})
`;
console.timeEnd("insert users");

console.time("insert posts");
await orm.$raw`
  INSERT INTO posts (id, title, author_id) VALUES
  (${Bun.randomUUIDv7()}, 'Hello World', ${johnId}),
  (${Bun.randomUUIDv7()}, 'SQLite include demo', ${johnId}),
  (${Bun.randomUUIDv7()}, 'Using Semola ORM', ${janeId}),
  (${Bun.randomUUIDv7()}, 'Composability matters', ${bobId})
`;
console.timeEnd("insert posts");

console.time("findMany users");
const users = await orm.users.findMany({
  take: 1,
  include: {
    posts: true,
  },
});
console.timeEnd("findMany users");

console.log(users);

console.time("findMany posts");
const posts = await orm.posts.findMany({
  take: 1,
  include: {
    author: true,
  },
});
console.timeEnd("findMany posts");

console.log(posts);

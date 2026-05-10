import { date, string, uuid } from "./column/index.js";
import { createOrm } from "./orm/index.js";
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

const orm = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: {
    users: usersTable,
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

console.time("findMany");
await orm.users.findMany();
console.timeEnd("findMany");

console.time("findFirst");
await orm.users.findFirst({
  where: {
    firstName: {
      startsWith: "J",
    },
  },
  orderBy: {
    createdAt: "asc",
  },
});
console.timeEnd("findFirst");

console.time("findUnique");
await orm.users.findUnique({
  where: {
    id: "user-1",
  },
});
console.timeEnd("findUnique");

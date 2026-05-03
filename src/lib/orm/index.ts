import { string, uuid } from "./column/index.js";
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
});

const orm = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: {
    users: usersTable,
  },
});

console.time("create table");
await orm.$raw`
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  )
`;
console.timeEnd("create table");

console.time("insert users");
await orm.$raw`
  INSERT INTO users (id, first_name, last_name, email) VALUES
  (${Bun.randomUUIDv7()}, 'John', 'Doe', 'john@example.com'),
  (${Bun.randomUUIDv7()}, 'Jane', 'Smith', 'jane@example.com'),
  (${Bun.randomUUIDv7()}, 'Bob', 'Johnson', 'bob@example.com'),
  (${Bun.randomUUIDv7()}, 'Alice', 'Williams', 'alice@example.com'),
  (${Bun.randomUUIDv7()}, 'Charlie', 'Brown', 'charlie@example.com')
`;
console.timeEnd("insert users");

console.time("findMany");
const users = await orm.users.findMany();
console.timeEnd("findMany");

console.log(users);

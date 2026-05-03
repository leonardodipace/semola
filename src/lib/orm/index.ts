import { uuid } from "./column/index.js";
import { createOrm } from "./orm/index.js";
import { defineTable } from "./table/index.js";

const usersTable = defineTable("users", {
  id: uuid("id")
    .primaryKey()
    // .notNull()
    .default(() => Bun.randomUUIDv7()),
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
    id TEXT PRIMARY KEY NOT NULL
  )
`;
console.timeEnd("create table");

console.time("findMany");
const users = await orm.users.findMany();
console.timeEnd("findMany");

console.log(users.map((user) => user.id));

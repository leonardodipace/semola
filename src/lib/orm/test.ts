import { boolean, number, Orm, string, Table } from "./index.js";

const usersTable = new Table("users", {
  id: number("id").primaryKey(),
  name: string("name").notNull(),
  email: string("email").unique().notNull(),
  active: boolean("active").default(true),
});

const orm = new Orm({
  url: ":memory:",
  tables: {
    users: usersTable,
  },
});

const users = await orm.tables.users.findMany();

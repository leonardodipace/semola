import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { createOrm, many, one } from "./index.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
});

const postsTable = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
});

describe("relation helpers", () => {
  test("many() returns a hasMany descriptor", () => {
    const relation = many(() => postsTable);

    expect(relation._type).toBe("hasMany");
    expect(relation._table).toBe(postsTable);
  });

  test("one() returns a hasOne descriptor", () => {
    const relation = one(() => usersTable);

    expect(relation._type).toBe("hasOne");
    expect(relation._table).toBe(usersTable);
  });

  test("createOrm() wires table clients and exposes raw SQL client", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: usersTable,
      },
    });

    expect(typeof orm.users.findMany).toBe("function");
    expect(orm.$raw).toBeDefined();

    if ("close" in orm.$raw) {
      await orm.$raw.close();
    }
  });
});

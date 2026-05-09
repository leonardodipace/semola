import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { createOrm, many, one } from "./index.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").notNull().unique(),
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
    expect(typeof orm.users.findUnique).toBe("function");
    expect(orm.$raw).toBeDefined();

    if ("close" in orm.$raw) {
      await orm.$raw.close();
    }
  });

  test("findUnique types only accept a single unique key", async () => {
    const orm = createOrm({
      adapter: "sqlite",
      url: ":memory:",
      tables: {
        users: usersTable,
      },
    });

    const acceptFindUniqueOptions = <TOptions>(_options: TOptions) => {
      return undefined;
    };

    acceptFindUniqueOptions<Parameters<typeof orm.users.findUnique>[0]>({
      where: {
        id: "user-1",
      },
    });

    acceptFindUniqueOptions<Parameters<typeof orm.users.findUnique>[0]>({
      where: {
        email: "john@example.com",
      },
    });

    const invalidByName: Parameters<typeof orm.users.findUnique>[0] = {
      where: {
        // @ts-expect-error - non-unique columns are invalid for findUnique where
        name: "John",
      },
    };

    expect(invalidByName).toBeDefined();

    const invalidByManyKeys: Parameters<typeof orm.users.findUnique>[0] = {
      // @ts-expect-error - only one unique key is allowed in findUnique where
      where: {
        id: "user-1",
        email: "john@example.com",
      },
    };

    expect(invalidByManyKeys).toBeDefined();

    const invalidByOperator: Parameters<typeof orm.users.findUnique>[0] = {
      where: {
        // @ts-expect-error - findUnique only accepts direct equality
        id: {
          endsWith: "user-1",
        },
      },
    };

    expect(invalidByOperator).toBeDefined();

    const invalidByEqObject: Parameters<typeof orm.users.findUnique>[0] = {
      where: {
        // @ts-expect-error - eq object syntax is not allowed for findUnique
        id: {
          eq: "user-1",
        },
      },
    };

    expect(invalidByEqObject).toBeDefined();

    if ("close" in orm.$raw) {
      await orm.$raw.close();
    }
  });
});

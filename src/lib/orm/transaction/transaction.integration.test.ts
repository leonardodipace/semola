import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import {
  integrationAdapters,
  PG_ID,
  PG_ID_2,
  PG_ID_3,
} from "../integration-helpers.js";
import { createOrm } from "../orm/index.js";
import { defineTable } from "../table/index.js";

const usersTable = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").notNull().unique(),
});

const accountsTable = defineTable("accounts", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  balance: string("balance").notNull(),
});

const schemaSql = {
  sqlite: {
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    accounts:
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, balance TEXT NOT NULL)",
  },
  postgres: {
    users:
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    accounts:
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, balance TEXT NOT NULL)",
  },
} as const;

for (const live of integrationAdapters()) {
  describe(`${live.adapter} $transaction integration`, () => {
    const ddl = schemaSql[live.adapter];
    const userId = live.adapter === "postgres" ? PG_ID : "u1";
    const userId2 = live.adapter === "postgres" ? PG_ID_2 : "u2";
    const accountId = live.adapter === "postgres" ? PG_ID_2 : "a1";
    const accountId2 = live.adapter === "postgres" ? PG_ID_3 : "a2";

    const open = async () => {
      await live.beforeEach?.();

      const orm = createOrm({
        adapter: live.adapter,
        url: live.url,
        tables: { users: usersTable, accounts: accountsTable },
      });

      await orm.$raw.unsafe(ddl.users);
      await orm.$raw.unsafe(ddl.accounts);

      return orm;
    };

    test("commits on success", async () => {
      const orm = await open();

      const result = await orm.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            id: userId,
            name: "Alice",
            email: "alice@example.com",
          },
        });
        const account = await tx.accounts.create({
          data: {
            id: accountId,
            userId: user.id,
            balance: "1000",
          },
        });

        return { user, account };
      });

      expect(result.user.id).toBe(userId);
      expect(result.account.userId).toBe(userId);
      expect(await orm.users.findMany()).toHaveLength(1);
      expect(await orm.accounts.findMany()).toHaveLength(1);

      await orm.$raw.close();
    });

    test("rolls back on error", async () => {
      const orm = await open();

      await expect(
        orm.$transaction(async (tx) => {
          await tx.users.create({
            data: {
              id: userId,
              name: "Alice",
              email: "alice@example.com",
            },
          });

          throw new Error("Rollback transaction");
        }),
      ).rejects.toThrow("Rollback transaction");

      expect(await orm.users.findMany()).toHaveLength(0);

      await orm.$raw.close();
    });

    test("transaction client has $raw access", async () => {
      const orm = await open();

      await orm.$transaction(async (tx) => {
        if (live.adapter === "sqlite") {
          await tx.$raw.unsafe("INSERT INTO users VALUES (?, ?, ?)", [
            userId,
            "Alice",
            "alice@example.com",
          ]);
        } else {
          await tx.$raw.unsafe("INSERT INTO users VALUES ($1, $2, $3)", [
            userId,
            "Alice",
            "alice@example.com",
          ]);
        }

        expect(await tx.users.findMany()).toHaveLength(1);
      });

      expect(await orm.users.findMany()).toHaveLength(1);

      await orm.$raw.close();
    });

    test("nested queries within transaction work correctly", async () => {
      const orm = await open();

      await orm.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            id: userId,
            name: "Alice",
            email: "alice@example.com",
          },
        });

        await tx.accounts.createMany({
          data: [
            { id: accountId, userId: user.id, balance: "1000" },
            { id: accountId2, userId: user.id, balance: "2000" },
          ],
        });

        expect(
          await tx.accounts.findMany({ where: { userId: user.id } }),
        ).toHaveLength(2);
      });

      expect(await orm.accounts.findMany()).toHaveLength(2);

      await orm.$raw.close();
    });

    test("supports update and delete", async () => {
      const orm = await open();

      await orm.users.create({
        data: {
          id: userId,
          name: "Alice",
          email: "alice@example.com",
        },
      });

      await orm.$transaction(async (tx) => {
        const updated = await tx.users.update({
          where: { id: userId },
          data: { name: "Alice Updated" },
        });

        expect(updated.name).toBe("Alice Updated");

        const deleted = await tx.users.delete({
          where: { id: userId },
        });

        expect(deleted.name).toBe("Alice Updated");
        expect(await tx.users.findUnique({ where: { id: userId } })).toBeNull();
      });

      expect(await orm.users.findUnique({ where: { id: userId } })).toBeNull();

      await orm.$raw.close();
    });

    test("multiple sequential transactions work independently", async () => {
      const orm = await open();

      await orm.$transaction(async (tx) => {
        await tx.users.create({
          data: {
            id: userId,
            name: "Alice",
            email: "alice@example.com",
          },
        });
      });

      await orm.$transaction(async (tx) => {
        await tx.users.create({
          data: {
            id: userId2,
            name: "Bob",
            email: "bob@example.com",
          },
        });
      });

      expect(await orm.users.findMany()).toHaveLength(2);

      await orm.$raw.close();
    });

    test.skipIf(live.adapter !== "sqlite")(
      "rejects nested transactions started from the root client",
      async () => {
        const orm = await open();

        await expect(
          orm.$transaction(async (tx) => {
            await tx.users.create({
              data: {
                id: userId,
                name: "Alice",
                email: "alice@example.com",
              },
            });

            await orm.$transaction(async () => {
              return undefined;
            });
          }),
        ).rejects.toThrow("cannot start a transaction within a transaction");

        expect(await orm.users.findMany()).toHaveLength(0);

        await orm.$raw.close();
      },
    );
  });
}

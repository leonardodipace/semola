import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { mightThrow } from "../../errors/index.js";
import { string, uuid } from "../column/index.js";
import { createOrm } from "../orm/index.js";
import { defineTable } from "../table/index.js";
import { getDialect } from "./index.js";
import { beginSqlite, formatSqliteDbDefault } from "./sqlite.js";
import { usersTable } from "./test-fixtures.js";

describe("sqlite dialect", () => {
  test("reports sqlite as its name", () => {
    const dialect = getDialect({
      adapter: "sqlite",
      table: usersTable,
      relations: {},
    });

    expect(dialect.name).toBe("sqlite");
  });

  test("beginSqlite serializes overlapping begin calls", async () => {
    const sql = new Bun.SQL(":memory:");
    const order: string[] = [];

    const first = beginSqlite(sql, async () => {
      order.push("a-start");
      await Bun.sleep(20);
      order.push("a-end");

      return "a";
    });

    const second = beginSqlite(sql, async () => {
      order.push("b-start");
      order.push("b-end");

      return "b";
    });

    expect(await Promise.all([first, second])).toEqual(["a", "b"]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);

    await sql.close();
  });

  test("beginSqlite still rejects nested begin on the same async chain", async () => {
    const sql = new Bun.SQL(":memory:");

    await expect(
      beginSqlite(sql, async () => {
        await beginSqlite(sql, async () => undefined);
      }),
    ).rejects.toThrow("cannot start a transaction within a transaction");

    await sql.close();
  });

  test("beginSqlite continues the queue after a rejected transaction", async () => {
    const sql = new Bun.SQL(":memory:");

    const first = beginSqlite(sql, async () => {
      throw new Error("boom");
    });

    const second = beginSqlite(sql, async () => "ok");

    await expect(first).rejects.toThrow("boom");
    expect(await second).toBe("ok");

    await sql.close();
  });

  test("beginSqlite still queues a different connection from inside another transaction", async () => {
    const outer = new Bun.SQL(":memory:");
    const other = new Bun.SQL(":memory:");

    const holdOther = beginSqlite(other, async () => {
      await Bun.sleep(30);
    });

    await Bun.sleep(5);

    await beginSqlite(outer, async () => {
      expect(await beginSqlite(other, async () => "ok")).toBe("ok");
    });

    await holdOther;

    await outer.close();
    await other.close();
  });

  test("beginSqlite queues detached work after the parent transaction ends", async () => {
    const sql = new Bun.SQL(":memory:");
    let releaseDetached!: () => void;
    const detachedGate = new Promise<void>((resolve) => {
      releaseDetached = resolve;
    });
    let detachedStarted!: () => void;
    const detachedReady = new Promise<void>((resolve) => {
      detachedStarted = resolve;
    });

    let detached!: Promise<string>;

    await beginSqlite(sql, async () => {
      detached = (async () => {
        detachedStarted();
        await detachedGate;

        return beginSqlite(sql, async () => "detached");
      })();
    });

    await detachedReady;

    const hold = beginSqlite(sql, async () => {
      releaseDetached();
      await Bun.sleep(30);

      return "hold";
    });

    expect(await Promise.all([hold, detached])).toEqual(["hold", "detached"]);

    await sql.close();
  });
});

describe("formatSqliteDbDefault", () => {
  test("writes CURRENT_TIMESTAMP in any spelling as an ISO timestamp", () => {
    const iso = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

    expect(formatSqliteDbDefault("CURRENT_TIMESTAMP")).toBe(iso);
    expect(formatSqliteDbDefault("current_timestamp")).toBe(iso);
    expect(formatSqliteDbDefault("(CURRENT_TIMESTAMP)")).toBe(iso);
  });

  test("writes CURRENT_DATE as an ISO midnight", () => {
    expect(formatSqliteDbDefault("CURRENT_DATE")).toBe(
      "(strftime('%Y-%m-%dT00:00:00.000Z', 'now'))",
    );
  });

  test("wraps function call defaults in parentheses", () => {
    expect(formatSqliteDbDefault("datetime('now')")).toBe("(datetime('now'))");
    expect(formatSqliteDbDefault("(random())")).toBe("(random())");
    expect(formatSqliteDbDefault("'member'")).toBe("'member'");
    expect(formatSqliteDbDefault("42")).toBe("42");
  });
});

describe("sqlite foreign keys", () => {
  const owners = defineTable({
    sqlName: "owners",
    columns: { id: uuid("id").primaryKey().notNull() },
  });
  const pets = defineTable({
    sqlName: "pets",
    columns: {
      id: uuid("id").primaryKey().notNull(),
      ownerId: string("owner_id").references(() => owners.columns.id),
    },
  });

  test("turn on after a first query that ran during an open transaction", async () => {
    const client = new SQL(":memory:");

    await client.unsafe("CREATE TABLE owners (id TEXT PRIMARY KEY)");
    await client.unsafe(
      "CREATE TABLE pets (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES owners(id))",
    );

    const orm = createOrm({
      adapter: "sqlite",
      client,
      tables: { owners, pets },
    });

    const raw = client.begin(async (tx) => {
      await tx.unsafe("INSERT INTO owners (id) VALUES ('a')");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await orm.owners.findMany();
    await raw;

    const [error] = await mightThrow(
      orm.pets.create({ data: { id: "p1", ownerId: "missing" } }),
    );

    expect(error?.message).toContain("FOREIGN KEY");

    await client.close();
  });
});

import { describe, expect, test } from "bun:test";
import { getDialect } from "./index.js";
import { beginSqlite } from "./sqlite.js";
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

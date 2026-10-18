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
});

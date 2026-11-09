import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { string, uuid } from "./column/index.js";
import { fromNodeSqlite } from "./node-sqlite.js";
import { createOrm } from "./orm/index.js";
import { defineTable } from "./table/index.js";
import type { SqlRow, SqlTransaction } from "./types.js";

const rowsOf = async (query: Promise<Iterable<SqlRow>>) => [...(await query)];

describe("fromNodeSqlite", () => {
  const open = async () => {
    const sql = fromNodeSqlite(new DatabaseSync(":memory:"));

    await sql.unsafe("CREATE TABLE t (id INTEGER PRIMARY KEY, flag INTEGER)");

    return sql;
  };

  test("binds booleans as integers and undefined as null", async () => {
    const sql = await open();

    await sql.unsafe("INSERT INTO t (id, flag) VALUES (?, ?)", [1, true]);
    await sql.unsafe("INSERT INTO t (id, flag) VALUES (?, ?)", [2, undefined]);

    expect(await rowsOf(sql.unsafe("SELECT * FROM t ORDER BY id"))).toEqual([
      { id: 1, flag: 1 },
      { id: 2, flag: null },
    ]);
  });

  test("rejects a leading Date instead of shifting the other params", async () => {
    const sql = await open();

    const query = sql.unsafe("SELECT ? AS a, ? AS b", [new Date(0), 5]);

    await expect(query).rejects.toThrow("cannot be bound");
  });

  test("returns plain objects like Bun.SQL", async () => {
    const sql = await open();

    await sql.unsafe("INSERT INTO t (id) VALUES (1)");

    const [row] = await rowsOf(sql.unsafe("SELECT id FROM t"));

    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });

  test("begin commits and returns the callback result", async () => {
    const sql = await open();

    const result = await sql.begin(async (tx) => {
      await tx.unsafe("INSERT INTO t (id) VALUES (1)");

      return "done";
    });

    expect(result).toBe("done");
    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([{ id: 1 }]);
  });

  test("begin rolls back and rethrows the callback error", async () => {
    const sql = await open();

    const failing = sql.begin(async (tx) => {
      await tx.unsafe("INSERT INTO t (id) VALUES (1)");
      throw new Error("boom");
    });

    await expect(failing).rejects.toThrow("boom");
    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([]);
  });

  test("begin accepts a transaction mode", async () => {
    const sql = await open();

    await sql.begin("IMMEDIATE", async (tx) => {
      await tx.unsafe("INSERT INTO t (id) VALUES (1)");
    });

    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([{ id: 1 }]);
  });

  test("a failed COMMIT rolls back so the next transaction can start", async () => {
    const sql = await open();

    await sql.unsafe("PRAGMA foreign_keys = ON");
    await sql.unsafe(
      "CREATE TABLE child (parent_id INTEGER REFERENCES t(id) DEFERRABLE INITIALLY DEFERRED)",
    );

    const failing = sql.begin(async (tx) => {
      await tx.unsafe("INSERT INTO child (parent_id) VALUES (99)");
    });

    await expect(failing).rejects.toThrow();

    await sql.begin(async (tx) => {
      await tx.unsafe("INSERT INTO t (id) VALUES (1)");
    });

    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([{ id: 1 }]);
  });

  test("a failed savepoint rolls back without aborting the transaction", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      await tx.unsafe("INSERT INTO t (id) VALUES (1)");

      const inner = tx.savepoint("sp", async (nested) => {
        await nested.unsafe("INSERT INTO t (id) VALUES (2)");
        throw new Error("inner");
      });

      await expect(inner).rejects.toThrow("inner");

      await tx.savepoint("sp", async (nested) => {
        await nested.unsafe("INSERT INTO t (id) VALUES (3)");
      });
    });

    expect(await rowsOf(sql.unsafe("SELECT id FROM t ORDER BY id"))).toEqual([
      { id: 1 },
      { id: 3 },
    ]);
  });

  test("overlapping sibling savepoints keep only the successful write", async () => {
    const sql = await open();
    let releaseFirst = () => {};
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const results = await sql.begin(async (tx) => {
      const succeeds = tx.savepoint("sp", async (nested) => {
        await nested.unsafe("INSERT INTO t (id) VALUES (1)");
        await firstMayFinish;
      });
      const fails = tx.savepoint("sp", async (nested) => {
        await nested.unsafe("INSERT INTO t (id) VALUES (2)");
        throw new Error("sibling");
      });

      releaseFirst();

      return Promise.allSettled([succeeds, fails]);
    });

    const statuses = results.map((result) => result.status);
    const rows = await rowsOf(sql.unsafe("SELECT id FROM t"));

    expect(statuses).toEqual(["fulfilled", "rejected"]);
    expect(rows).toEqual([{ id: 1 }]);
  });

  test("overlapping valid sibling savepoints both succeed", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      await Promise.all([
        tx.savepoint("sp", async (nested) => {
          await nested.unsafe("INSERT INTO t (id) VALUES (1)");
        }),
        tx.savepoint("sp", async (nested) => {
          await nested.unsafe("INSERT INTO t (id) VALUES (2)");
        }),
      ]);
    });

    const rows = await rowsOf(sql.unsafe("SELECT id FROM t ORDER BY id"));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("a nested savepoint runs inside its parent without waiting on it", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      await tx.savepoint("outer", async (outer) => {
        await outer.unsafe("INSERT INTO t (id) VALUES (1)");

        // The runtime client is a transaction; the shared type only says queryable.
        const inner = (outer as SqlTransaction).savepoint(
          "inner",
          async (nested) => {
            await nested.unsafe("INSERT INTO t (id) VALUES (2)");
          },
        );

        await inner;
      });
    });

    const rows = await rowsOf(sql.unsafe("SELECT id FROM t ORDER BY id"));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("unsafe runs every statement of a multi-statement string", async () => {
    const sql = await open();

    await sql.unsafe(
      "INSERT INTO t (id) VALUES (1); INSERT INTO t (id) VALUES (2)",
    );

    const rows = await rowsOf(sql.unsafe("SELECT id FROM t ORDER BY id"));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("unsafe runs a trigger body as one statement", async () => {
    const sql = await open();

    await sql.unsafe(`
      CREATE TRIGGER t_flag AFTER INSERT ON t BEGIN
        UPDATE t SET flag = 1 WHERE id = NEW.id;
      END;
      INSERT INTO t (id) VALUES (1);
    `);

    const rows = await rowsOf(sql.unsafe("SELECT * FROM t"));

    expect(rows).toEqual([{ id: 1, flag: 1 }]);
  });

  test("unsafe rejects several statements that share params", async () => {
    const sql = await open();

    await expect(
      sql.unsafe(
        "INSERT INTO t (id) VALUES (?); INSERT INTO t (id) VALUES (?)",
        [1, 2],
      ),
    ).rejects.toThrow("cannot share params");
  });

  test("close closes the database", async () => {
    const db = new DatabaseSync(":memory:");

    await fromNodeSqlite(db).close();

    expect(db.isOpen).toBe(false);
  });
});

describe("createOrm client option", () => {
  const users = defineTable({
    sqlName: "users",
    columns: {
      id: uuid("id").primaryKey().notNull(),
      name: string("name").notNull(),
    },
  });

  test("uses the supplied client as $raw", async () => {
    const client = fromNodeSqlite(new DatabaseSync(":memory:"));
    const db = createOrm({ adapter: "sqlite", client, tables: { users } });

    expect(db.$raw).toBe(client);

    await db.$raw.close();
  });
});

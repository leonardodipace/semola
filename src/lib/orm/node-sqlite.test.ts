import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { string, uuid } from "./column/index.js";
import { fromNodeSqlite } from "./node-sqlite.js";
import { createOrm, many, one } from "./orm/index.js";
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

  test("a savepoint on the outer transaction nests inside the running one", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      await tx.savepoint("outer", async () => {
        await tx.savepoint("inner", async (nested) => {
          await nested.unsafe("INSERT INTO t (id) VALUES (1)");
        });

        await tx.savepoint("inner", async (nested) => {
          await nested.unsafe("INSERT INTO t (id) VALUES (2)");
        });
      });
    });

    const rows = await rowsOf(sql.unsafe("SELECT id FROM t ORDER BY id"));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("concurrent savepoints through the outer transaction nest without overlapping", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      await tx.savepoint("outer", async () => {
        await Promise.allSettled([
          tx.savepoint("inner", async (nested) => {
            await nested.unsafe("INSERT INTO t (id) VALUES (1)");
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw new Error("first");
          }),
          tx.savepoint("inner", async (nested) => {
            await nested.unsafe("INSERT INTO t (id) VALUES (2)");
          }),
        ]);
      });
    });

    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([{ id: 2 }]);
  });

  test("a savepoint callback that throws synchronously rolls back its writes", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      const throwing = tx.savepoint("sp", (nested) => {
        void nested.unsafe("INSERT INTO t (id) VALUES (1)");
        throw new Error("sync");
      });

      await expect(throwing).rejects.toThrow("sync");
    });

    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([]);
  });

  test("savepoint names are quoted", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      await tx.savepoint("my-sp", async (nested) => {
        await nested.unsafe("INSERT INTO t (id) VALUES (1)");
      });
    });

    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([{ id: 1 }]);
  });

  test("concurrent transactions wait for each other", async () => {
    const sql = await open();

    await Promise.all([
      sql.begin(async (tx) => {
        await tx.unsafe("INSERT INTO t (id) VALUES (1)");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
      sql.begin(async (tx) => {
        await tx.unsafe("INSERT INTO t (id) VALUES (2)");
      }),
    ]);

    const rows = await rowsOf(sql.unsafe("SELECT id FROM t ORDER BY id"));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("a transaction started inside another rejects instead of hanging", async () => {
    const sql = await open();

    await sql.begin(async () => {
      const nested = sql.begin(async () => "inner");

      await expect(nested).rejects.toThrow("within a transaction");
    });
  });

  test("a timer scheduled inside a transaction can start one after it ends", async () => {
    const sql = await open();
    let later: Promise<unknown> | undefined;

    await sql.begin(async () => {
      later = new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            sql.begin(async (tx) => {
              await tx.unsafe("INSERT INTO t (id) VALUES (1)");
            }),
          );
        }, 5);
      });
    });

    await later;

    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([{ id: 1 }]);
  });

  test("a transaction rejects queries after it ends", async () => {
    const sql = await open();
    let ended: SqlTransaction | undefined;

    await sql.begin(async (tx) => {
      ended = tx;
    });

    const late = ended?.unsafe("INSERT INTO t (id) VALUES (1)");
    const lateSavepoint = ended?.savepoint("late", async (nested) => {
      await nested.unsafe("INSERT INTO t (id) VALUES (2)");
    });

    await expect(late).rejects.toThrow("transaction or savepoint ended");
    await expect(lateSavepoint).rejects.toThrow(
      "transaction or savepoint ended",
    );
    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([]);
  });

  test("a savepoint rejects queries after it ends", async () => {
    const sql = await open();

    await sql.begin(async (tx) => {
      let ended: SqlTransaction | undefined;

      await tx.savepoint("sp", async (nested) => {
        ended = nested as SqlTransaction;
      });

      const late = ended?.unsafe("INSERT INTO t (id) VALUES (1)");

      await expect(late).rejects.toThrow("transaction or savepoint ended");
    });
  });

  test("an unawaited savepoint cannot write after its transaction rolls back", async () => {
    const sql = await open();
    let late: Promise<unknown> | undefined;

    const failing = sql.begin(async (tx) => {
      late = tx
        .savepoint("sp", async (nested) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          await nested.unsafe("INSERT INTO t (id) VALUES (1)");
        })
        .catch((error) => error);

      throw new Error("boom");
    });

    await expect(failing).rejects.toThrow("boom");
    await late;

    expect(await rowsOf(sql.unsafe("SELECT id FROM t"))).toEqual([]);
  });

  test("a queued savepoint does not start after its transaction commits", async () => {
    const sql = await open();
    let queued: Promise<unknown> | undefined;

    await sql.begin(async (tx) => {
      void tx.savepoint("first", async (nested) => {
        await nested.unsafe("INSERT INTO t (id) VALUES (1)");
      });

      queued = tx
        .savepoint("second", async (nested) => {
          await nested.unsafe("INSERT INTO t (id) VALUES (2)");
        })
        .catch((error) => error);
    });

    const error = await queued;
    const rows = await rowsOf(sql.unsafe("SELECT id FROM t ORDER BY id"));

    expect(error).toBeInstanceOf(Error);
    expect(rows).not.toContainEqual({ id: 2 });
  });

  test("a rolled back transaction rejects queries after it ends", async () => {
    const sql = await open();
    let ended: SqlTransaction | undefined;

    const failing = sql.begin(async (tx) => {
      ended = tx;
      throw new Error("boom");
    });

    await expect(failing).rejects.toThrow("boom");

    const late = ended?.unsafe("INSERT INTO t (id) VALUES (1)");

    await expect(late).rejects.toThrow("transaction or savepoint ended");
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

describe("ORM on fromNodeSqlite", () => {
  const users = defineTable({
    sqlName: "users",
    columns: {
      id: uuid("id").primaryKey().notNull(),
    },
  });
  const notes = defineTable({
    sqlName: "notes",
    columns: {
      id: uuid("id").primaryKey().notNull(),
      userId: uuid("user_id").references(() => users.columns.id),
    },
  });

  const open = async () => {
    const client = fromNodeSqlite(new DatabaseSync(":memory:"));

    await client.unsafe(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
      INSERT INTO users (id) VALUES ('u1');
      INSERT INTO notes (id) VALUES ('n1'), ('n2');
    `);

    return createOrm({
      adapter: "sqlite",
      client,
      tables: { users, notes },
      relations: {
        users: { notes: many(() => notes) },
        notes: { user: one("userId", () => users) },
      },
    });
  };

  const sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  test("a relation write and a raw savepoint running together both finish", async () => {
    const orm = await open();

    await orm.$transaction((tx) => {
      return Promise.all([
        tx.users.update({
          where: { id: "u1" },
          data: { notes: { connect: [{ id: "n1" }] } },
        }),
        (tx.$raw as unknown as SqlTransaction).savepoint("sp", () => {
          return tx.users.update({
            where: { id: "u1" },
            data: { notes: { connect: [{ id: "n2" }] } },
          });
        }),
      ]);
    });

    const user = await orm.users.findUnique({
      where: { id: "u1" },
      include: { notes: true },
    });

    expect(user?.notes).toHaveLength(2);
  });

  test("$transaction inside a raw begin rejects while another one waits", async () => {
    const orm = await open();
    let nested: unknown;

    const raw = orm.$raw.begin(async () => {
      await sleep(10);

      nested = await orm.$transaction(async () => 1).catch((error) => error);
    });
    const waiting = orm.$transaction(async () => 2);

    await Promise.all([raw, waiting]);

    expect(nested).toBeInstanceOf(Error);
  });
});

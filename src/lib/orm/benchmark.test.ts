import { describe, expect, test } from "bun:test";
import type { SQL as SQLType } from "bun";
import { SQL } from "bun";
import { string, uuid } from "./column.js";
import { postgresDialectAdapter } from "./dialect/postgres.js";
import { createOrm } from "./orm.js";
import { buildSelectPlan } from "./sql/plan.js";
import { serializeSelectPlan } from "./sql/serialize.js";
import { createTable } from "./table.js";

type MockCall = { strings: readonly string[]; values: unknown[] };

function makeMockSql() {
  const calls: MockCall[] = [];

  function fn(
    stringsOrValue: TemplateStringsArray | unknown,
    ...values: unknown[]
  ): unknown {
    if (Array.isArray(stringsOrValue) && "raw" in (stringsOrValue as object)) {
      calls.push({
        strings: [...(stringsOrValue as readonly string[])],
        values,
      });

      return Promise.resolve([]);
    }

    return { __mock: stringsOrValue, __values: values };
  }

  fn.calls = calls;

  return fn as unknown as SQLType & { calls: MockCall[] };
}

function runLoop(iterations: number, fn: () => void) {
  const start = performance.now();

  for (let index = 0; index < iterations; index++) {
    fn();
  }

  const end = performance.now();

  return end - start;
}

const users = createTable("users", {
  id: uuid("id").primaryKey(),
  email: string("email").notNull(),
  name: string("name").notNull(),
});

const runBenchmarks = process.env.SEMOLA_BENCH === "1";
const benchTest = runBenchmarks ? test : test.skip;

describe("ORM benchmarks", () => {
  benchTest("select serialization overhead stays bounded", () => {
    const iterations = 20_000;

    const rawSql = makeMockSql();
    const ormSql = makeMockSql();

    const rawMs = runLoop(iterations, () => {
      void rawSql`SELECT * FROM ${rawSql(users.tableName)} WHERE ${rawSql("email")} = ${"a@b.com"} ORDER BY ${rawSql("name")} ASC LIMIT ${20} OFFSET ${40}`;
    });

    const plan = buildSelectPlan({
      where: { email: "a@b.com" },
      orderBy: { name: "asc" },
      limit: 20,
      offset: 40,
    });

    const ormMs = runLoop(iterations, () => {
      void serializeSelectPlan(ormSql, users, {}, plan, postgresDialectAdapter);
    });

    const overheadRatio = ormMs / Math.max(rawMs, 0.001);

    console.log(
      `bench: raw=${rawMs.toFixed(2)}ms orm=${ormMs.toFixed(2)}ms ratio=${overheadRatio.toFixed(2)}x`,
    );

    expect(overheadRatio).toBeLessThan(6);
  });

  benchTest("end-to-end select stays near raw Bun.SQL", async () => {
    const rawSql = new SQL("sqlite::memory:");

    await rawSql`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL)`;

    for (let index = 0; index < 200; index++) {
      await rawSql`INSERT INTO users (id, email, name) VALUES (${String(index)}, ${`user${index}@example.com`}, ${`User ${index}`})`;
    }

    const orm = createOrm({
      url: "sqlite::memory:",
      tables: {
        users,
      },
    });

    await orm.$raw`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL)`;

    for (let index = 0; index < 200; index++) {
      await orm.$raw`INSERT INTO users (id, email, name) VALUES (${String(index)}, ${`user${index}@example.com`}, ${`User ${index}`})`;
    }

    const iterations = 400;

    const rawStart = performance.now();

    for (let index = 0; index < iterations; index++) {
      await rawSql`SELECT * FROM users WHERE email = ${"user42@example.com"} LIMIT ${1}`;
    }

    const rawMs = performance.now() - rawStart;

    const ormStart = performance.now();

    for (let index = 0; index < iterations; index++) {
      await orm.users.select({
        where: { email: "user42@example.com" },
        limit: 1,
      });
    }

    const ormMs = performance.now() - ormStart;

    const overheadRatio = ormMs / Math.max(rawMs, 0.001);

    console.log(
      `bench-e2e: raw=${rawMs.toFixed(2)}ms orm=${ormMs.toFixed(2)}ms ratio=${overheadRatio.toFixed(2)}x`,
    );

    expect(overheadRatio).toBeLessThan(2);
  });
});

import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { boolean as booleanCol, string, uuid } from "../column.js";
import { postgresDialectAdapter } from "../dialect/postgres.js";
import { sqliteDialectAdapter } from "../dialect/sqlite.js";
import { many } from "../relation.js";
import { createTable } from "../table.js";
import { buildSelectPlan } from "./plan.js";
import {
  mapDataToSqlRow,
  serializeSelectInput,
  serializeSelectPlan,
  serializeWhereInput,
} from "./serialize.js";

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

  return fn as unknown as SQL & { calls: MockCall[] };
}

const users = createTable("users", {
  id: uuid("id").primaryKey(),
  name: string("name").notNull(),
});

const tasks = createTable("tasks", {
  id: uuid("id").primaryKey(),
  assigneeId: uuid("assignee_id")
    .notNull()
    .references(() => users.columns.id),
  title: string("title").notNull(),
});

const flags = createTable("flags", {
  id: uuid("id").primaryKey(),
  enabled: booleanCol("enabled"),
});

describe("mapDataToSqlRow", () => {
  test("maps JS keys to SQL names at serialization", () => {
    const row = mapDataToSqlRow(
      tasks,
      { assigneeId: "u1", title: "Do it" },
      postgresDialectAdapter,
    );

    expect(row).toEqual(
      Object.fromEntries([
        ["assignee_id", "u1"],
        ["title", "Do it"],
      ]),
    );
  });

  test("applies dialect serialization for booleans", () => {
    const row = mapDataToSqlRow(
      createTable("flags", {
        id: uuid("id").primaryKey(),
        enabled: booleanCol("enabled"),
      }),
      { enabled: true },
      sqliteDialectAdapter,
    );

    expect(row.enabled).toBe(1);
  });
});

describe("serializeWhereInput", () => {
  test("renders rich where operators", () => {
    const sql = makeMockSql();

    void serializeWhereInput(
      sql,
      users,
      {
        name: {
          startsWith: "A",
          endsWith: "e",
          contains: "li",
          equals: "Alice",
          not: "Bob",
          in: ["Alice", "Eve"],
          notIn: ["Mallory"],
          isNull: false,
        },
      },
      postgresDialectAdapter,
    );

    const all = sql.calls.flatMap((call) => call.strings).join(" ");

    expect(all).toContain("WHERE");
    expect(all).toContain("LIKE");
    expect(all).toContain(" IN ");
    expect(all).toContain("NOT IN");
    expect(all).toContain("IS NOT NULL");
  });

  test("returns empty fragment when no valid columns exist", () => {
    const sql = makeMockSql();

    void serializeWhereInput(sql, users, undefined, postgresDialectAdapter);

    const all = sql.calls.flatMap((call) => call.strings).join(" ");
    expect(all).not.toContain("WHERE");
  });

  test("serializes comparison operators through dialect adapter", () => {
    const sql = makeMockSql();

    void serializeWhereInput(
      sql,
      flags,
      {
        enabled: {
          gt: true,
          gte: true,
          lt: false,
          lte: false,
        },
      },
      sqliteDialectAdapter,
    );

    const allValues = sql.calls.flatMap((call) => call.values);

    const primitiveValues = allValues.filter(
      (value) => typeof value === "number" || typeof value === "boolean",
    );

    expect(primitiveValues).toContain(1);
    expect(primitiveValues).toContain(0);
    expect(primitiveValues).not.toContain(true);
    expect(primitiveValues).not.toContain(false);
  });
});

describe("serializeSelectPlan", () => {
  test("renders select with joins/where/order/paging", () => {
    const sql = makeMockSql();

    const plan = buildSelectPlan({
      where: { name: { contains: "ali" } },
      include: { tasks: true },
      orderBy: { name: "asc" },
      limit: 5,
      offset: 10,
    });

    void serializeSelectPlan(
      sql,
      users,
      { tasks: many(() => tasks) },
      plan,
      postgresDialectAdapter,
    );

    const all = sql.calls.flatMap((call) => call.strings).join(" ");

    expect(all).toContain("SELECT * FROM");
    expect(all).toContain("LEFT JOIN");
    expect(all).toContain("WHERE");
    expect(all).toContain("ORDER BY");
    expect(all).toContain("LIMIT");
    expect(all).toContain("OFFSET");
  });

  test("supports one relation join", () => {
    const sql = makeMockSql();

    const assignees = createTable("assignees", {
      id: uuid("id").primaryKey(),
      name: string("name").notNull(),
    });

    const workItems = createTable("work_items", {
      id: uuid("id").primaryKey(),
      assigneeId: uuid("assignee_id").notNull(),
      title: string("title").notNull(),
    });

    const plan = buildSelectPlan({ include: { assignee: true } });

    void serializeSelectPlan(
      sql,
      workItems,
      {
        assignee: {
          kind: "one",
          foreignKey: "assignee_id",
          table: () => assignees,
        },
      },
      plan,
      postgresDialectAdapter,
    );

    const all = sql.calls.flatMap((call) => call.strings).join(" ");

    expect(all).toContain("LEFT JOIN");

    const allValues = sql.calls.flatMap((call) => call.values);
    const helperValues = allValues
      .map((value) => {
        if (typeof value !== "object" || value === null) {
          return value;
        }

        if (!("__mock" in value)) {
          return value;
        }

        return (value as { __mock: unknown }).__mock;
      })
      .filter((value) => typeof value === "string");

    expect(helperValues).toContain("assignee_id");
  });
});

describe("serializeSelectInput", () => {
  test("renders select directly from input", () => {
    const sql = makeMockSql();

    void serializeSelectInput(
      sql,
      users,
      { tasks: many(() => tasks) },
      {
        where: { name: { contains: "li" } },
        include: { tasks: true },
        orderBy: { name: "desc" },
        limit: 3,
        offset: 2,
      },
      postgresDialectAdapter,
    );

    const all = sql.calls.flatMap((call) => call.strings).join(" ");

    expect(all).toContain("SELECT * FROM");
    expect(all).toContain("LEFT JOIN");
    expect(all).toContain("WHERE");
    expect(all).toContain("ORDER BY");
    expect(all).toContain("LIMIT");
    expect(all).toContain("OFFSET");
    expect(all).toContain("DESC");
  });
});

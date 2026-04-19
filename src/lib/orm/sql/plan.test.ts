import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column.js";
import { createTable } from "../table.js";
import { buildSelectPlan, isLikePredicateValue } from "./plan.js";

const users = createTable("users", {
  id: uuid("id").primaryKey(),
  name: string("name").notNull(),
});

describe("buildSelectPlan", () => {
  test("returns empty plan for empty input", () => {
    const plan = buildSelectPlan();

    expect(plan.where).toBeUndefined();
    expect(plan.joins).toEqual([]);
    expect(plan.orderBy).toEqual([]);
    expect(plan.page).toEqual({ limit: undefined, offset: undefined });
  });

  test("builds where/join/order/paging plan", () => {
    const plan = buildSelectPlan({
      where: {
        name: { startsWith: "Al", not: "Bob" },
      },
      include: { tasks: true },
      orderBy: { name: "desc" },
      limit: 10,
      offset: 20,
    });

    expect(plan.where).toBeDefined();
    expect(plan.joins).toEqual([{ relationKey: "tasks", kind: "left" }]);
    expect(plan.orderBy).toEqual([{ key: "name", direction: "desc" }]);
    expect(plan.page).toEqual({ limit: 10, offset: 20 });
  });

  test("builds eq predicate for primitive where value", () => {
    const plan = buildSelectPlan<typeof users.columns, Record<never, never>>({
      where: { name: "Alice" },
    });

    expect(plan.where).toEqual({
      kind: "predicate",
      key: "name",
      op: "eq",
      value: "Alice",
    });
  });

  test("builds and-group for multiple operators", () => {
    const plan = buildSelectPlan<typeof users.columns, Record<never, never>>({
      where: {
        name: {
          startsWith: "A",
          notIn: ["Bob"],
          isNull: false,
        },
      },
    });

    expect(plan.where).toMatchObject({ kind: "and" });
  });

  test("skips disabled includes", () => {
    const plan = buildSelectPlan<typeof users.columns, { tasks: true }>({
      include: { tasks: undefined },
    });

    expect(plan.joins).toEqual([]);
  });
});

describe("isLikePredicateValue", () => {
  test("validates like value shape", () => {
    expect(isLikePredicateValue({ mode: "contains", value: "a" })).toBe(true);
    expect(isLikePredicateValue({ mode: "bad", value: "a" })).toBe(false);
    expect(isLikePredicateValue({ mode: "startsWith" })).toBe(false);
    expect(isLikePredicateValue("value")).toBe(false);
  });
});

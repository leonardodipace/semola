import { describe, expect, test } from "bun:test";
import { boolean, date, json, jsonb, number, string, uuid } from "./column.js";

describe("uuid()", () => {
  test("stores sqlName", () => {
    const col = uuid("user_id");
    expect(col.meta.sqlName).toBe("user_id");
  });

  test("kind is uuid", () => {
    expect(uuid("id").kind).toBe("uuid");
  });

  test("defaults are false/null", () => {
    const col = uuid("id");
    expect(col.meta.isPrimaryKey).toBe(false);
    expect(col.meta.isNotNull).toBe(false);
    expect(col.meta.isUnique).toBe(false);
    expect(col.meta.hasDefault).toBe(false);
    expect(col.meta.defaultFn).toBe(null);
    expect(col.meta.references).toBe(null);
    expect(col.meta.onDeleteAction).toBe(null);
  });
});

describe("string()", () => {
  test("kind is string", () => {
    expect(string("name").kind).toBe("string");
  });
});

describe("number()", () => {
  test("kind is number", () => {
    expect(number("age").kind).toBe("number");
  });
});

describe("boolean()", () => {
  test("kind is boolean", () => {
    expect(boolean("active").kind).toBe("boolean");
  });
});

describe("date()", () => {
  test("kind is date", () => {
    expect(date("created_at").kind).toBe("date");
  });
});

describe("json()", () => {
  test("kind is json", () => {
    expect(json<{ level: number }>("meta").kind).toBe("json");
  });
});

describe("jsonb()", () => {
  test("kind is jsonb", () => {
    expect(jsonb<{ level: number }>("meta").kind).toBe("jsonb");
  });
});

describe(".primaryKey()", () => {
  test("sets isPrimaryKey to true", () => {
    const col = uuid("id").primaryKey();
    expect(col.meta.isPrimaryKey).toBe(true);
  });

  test("also sets isNotNull to true", () => {
    const col = uuid("id").primaryKey();
    expect(col.meta.isNotNull).toBe(true);
  });

  test("does not mutate the original", () => {
    const original = uuid("id");
    original.primaryKey();
    expect(original.meta.isPrimaryKey).toBe(false);
  });
});

describe(".notNull()", () => {
  test("sets isNotNull to true", () => {
    const col = string("name").notNull();
    expect(col.meta.isNotNull).toBe(true);
  });

  test("does not mutate the original", () => {
    const original = string("name");
    original.notNull();
    expect(original.meta.isNotNull).toBe(false);
  });
});

describe(".unique()", () => {
  test("sets isUnique to true", () => {
    const col = string("email").unique();
    expect(col.meta.isUnique).toBe(true);
  });
});

describe(".references()", () => {
  test("stores the reference function", () => {
    const otherId = uuid("other_id");
    const col = uuid("ref_id").references(() => otherId);
    expect(col.meta.references).toBeFunction();
    expect(col.meta.references?.()).toBe(otherId);
  });
});

describe(".onDelete()", () => {
  test("stores CASCADE", () => {
    const col = uuid("ref_id").onDelete("CASCADE");
    expect(col.meta.onDeleteAction).toBe("CASCADE");
  });

  test("stores RESTRICT", () => {
    const col = uuid("ref_id").onDelete("RESTRICT");
    expect(col.meta.onDeleteAction).toBe("RESTRICT");
  });

  test("stores SET NULL", () => {
    const col = uuid("ref_id").onDelete("SET NULL");
    expect(col.meta.onDeleteAction).toBe("SET NULL");
  });
});

describe(".default()", () => {
  test("sets hasDefault to true", () => {
    const col = uuid("id").default("generated-id");
    expect(col.meta.hasDefault).toBe(true);
  });

  test("stores wrapped value as defaultFn", () => {
    const col = uuid("id").default("generated-id");
    expect(col.meta.defaultFn).toBeFunction();
    expect(col.meta.defaultFn?.()).toBe("generated-id");
  });
});

describe(".defaultFn()", () => {
  test("stores the default function", () => {
    const fn = () => "generated-id";
    const col = uuid("id").defaultFn(fn);
    expect(col.meta.defaultFn).toBe(fn);
  });

  test("calling defaultFn returns the value", () => {
    const col = string("slug").defaultFn(() => "my-slug");
    expect(col.meta.defaultFn?.()).toBe("my-slug");
  });
});

describe("chaining", () => {
  test("notNull + unique can be chained", () => {
    const col = string("email").notNull().unique();
    expect(col.meta.isNotNull).toBe(true);
    expect(col.meta.isUnique).toBe(true);
  });

  test("uuid pk chain", () => {
    const col = uuid("id").primaryKey();
    expect(col.meta.isPrimaryKey).toBe(true);
    expect(col.meta.isNotNull).toBe(true);
  });

  test("full chain does not affect earlier nodes", () => {
    const base = uuid("ref_id");
    const withRef = base.references(() => base);
    const withDelete = withRef.onDelete("CASCADE");
    expect(base.meta.references).toBe(null);
    expect(base.meta.onDeleteAction).toBe(null);
    expect(withRef.meta.onDeleteAction).toBe(null);
    expect(withDelete.meta.onDeleteAction).toBe("CASCADE");
  });
});

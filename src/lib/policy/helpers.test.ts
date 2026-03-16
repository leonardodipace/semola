import { describe, expect, test } from "bun:test";
import {
  and,
  endsWith,
  eq,
  gt,
  gte,
  has,
  hasAny,
  hasLength,
  includes,
  isDefined,
  isEmpty,
  isNullish,
  lt,
  lte,
  matches,
  neq,
  not,
  or,
  startsWith,
} from "./helpers.js";
import { Policy } from "./index.js";

describe("eq", () => {
  test("returns true when value strictly equals condition", () => {
    expect(eq("draft").fn("draft")).toBe(true);
  });

  test("returns false when value does not equal condition", () => {
    expect(eq("draft").fn("published")).toBe(false);
  });

  test("carries correct metadata", () => {
    const helper = eq(42);

    expect(helper.operator).toBe("eq");
    expect(helper.value).toBe(42);
  });
});

describe("neq", () => {
  test("returns true when value differs", () => {
    expect(neq("draft").fn("published")).toBe(true);
  });

  test("returns false when value equals condition", () => {
    expect(neq("draft").fn("draft")).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(neq(1).operator).toBe("neq");
  });
});

describe("gt", () => {
  test("returns true when actual is greater", () => {
    expect(gt(5).fn(10)).toBe(true);
  });

  test("returns false when actual equals condition", () => {
    expect(gt(5).fn(5)).toBe(false);
  });

  test("returns false when actual is less", () => {
    expect(gt(5).fn(3)).toBe(false);
  });

  test("works with Date values", () => {
    const past = new Date("2020-01-01");
    const future = new Date("2030-01-01");

    expect(gt(past).fn(future)).toBe(true);
    expect(gt(future).fn(past)).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(gt(5).operator).toBe("gt");
    expect(gt(5).value).toBe(5);
  });
});

describe("gte", () => {
  test("returns true when actual is greater", () => {
    expect(gte(5).fn(10)).toBe(true);
  });

  test("returns true when actual equals condition", () => {
    expect(gte(5).fn(5)).toBe(true);
  });

  test("returns false when actual is less", () => {
    expect(gte(5).fn(3)).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(gte(5).operator).toBe("gte");
  });
});

describe("lt", () => {
  test("returns true when actual is less", () => {
    expect(lt(10).fn(5)).toBe(true);
  });

  test("returns false when actual equals condition", () => {
    expect(lt(5).fn(5)).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(lt(1).operator).toBe("lt");
  });
});

describe("lte", () => {
  test("returns true when actual is less", () => {
    expect(lte(10).fn(5)).toBe(true);
  });

  test("returns true when actual equals condition", () => {
    expect(lte(5).fn(5)).toBe(true);
  });

  test("carries correct metadata", () => {
    expect(lte(1).operator).toBe("lte");
  });
});

describe("not", () => {
  test("negates a true result to false", () => {
    expect(not(eq("draft")).fn("draft")).toBe(false);
  });

  test("negates a false result to true", () => {
    expect(not(eq("draft")).fn("published")).toBe(true);
  });

  test("carries correct metadata", () => {
    const inner = eq("draft");
    const helper = not(inner);

    expect(helper.operator).toBe("not");
    expect(helper.value).toBe(inner);
  });

  test("double negation", () => {
    expect(not(not(eq("draft"))).fn("draft")).toBe(true);
    expect(not(not(eq("draft"))).fn("published")).toBe(false);
  });
});

describe("and", () => {
  test("returns true when all helpers match", () => {
    expect(and(gt(0), lt(10)).fn(5)).toBe(true);
  });

  test("returns false when any helper does not match", () => {
    expect(and(gt(0), lt(10)).fn(10)).toBe(false);
  });

  test("carries correct metadata", () => {
    const a = gt(0);
    const b = lt(10);
    const helper = and(a, b);

    expect(helper.operator).toBe("and");
    expect(helper.value).toEqual([a, b]);
  });
});

describe("or", () => {
  test("returns true when at least one helper matches", () => {
    expect(or(eq("draft"), eq("review")).fn("draft")).toBe(true);
    expect(or(eq("draft"), eq("review")).fn("review")).toBe(true);
  });

  test("returns false when no helper matches", () => {
    expect(or(eq("draft"), eq("review")).fn("published")).toBe(false);
  });

  test("carries correct metadata", () => {
    const a = eq("draft");
    const b = eq("review");
    const helper = or(a, b);

    expect(helper.operator).toBe("or");
    expect(helper.value).toEqual([a, b]);
  });
});

describe("startsWith", () => {
  test("returns true when string starts with prefix", () => {
    expect(startsWith("Hello").fn("Hello World")).toBe(true);
  });

  test("returns false when string does not start with prefix", () => {
    expect(startsWith("World").fn("Hello World")).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(startsWith("Hi").operator).toBe("startsWith");
    expect(startsWith("Hi").value).toBe("Hi");
  });
});

describe("endsWith", () => {
  test("returns true when string ends with suffix", () => {
    expect(endsWith("World").fn("Hello World")).toBe(true);
  });

  test("returns false when string does not end with suffix", () => {
    expect(endsWith("Hello").fn("Hello World")).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(endsWith("!").operator).toBe("endsWith");
  });
});

describe("includes", () => {
  test("returns true when string contains substring", () => {
    expect(includes("lo W").fn("Hello World")).toBe(true);
  });

  test("returns false when string does not contain substring", () => {
    expect(includes("xyz").fn("Hello World")).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(includes("test").operator).toBe("includes");
    expect(includes("test").value).toBe("test");
  });
});

describe("matches", () => {
  test("returns true when string matches pattern", () => {
    expect(matches(/^Hello/).fn("Hello World")).toBe(true);
  });

  test("returns false when string does not match pattern", () => {
    expect(matches(/^World/).fn("Hello World")).toBe(false);
  });

  test("carries correct metadata", () => {
    const pattern = /test/i;

    expect(matches(pattern).operator).toBe("matches");
    expect(matches(pattern).value).toBe(pattern);
  });
});

describe("has", () => {
  test("returns true when array includes a single value", () => {
    expect(has("tech").fn(["tech", "business"])).toBe(true);
  });

  test("returns false when array does not include a single value", () => {
    expect(has("tech").fn(["business"])).toBe(false);
  });

  test("returns true when array includes all condition values", () => {
    expect(has(["tech", "business"]).fn(["tech", "business", "finance"])).toBe(
      true,
    );
  });

  test("returns false when array is missing some condition values", () => {
    expect(has(["tech", "finance"]).fn(["tech", "business"])).toBe(false);
  });

  test("returns true when condition array is empty", () => {
    expect(has<string>([]).fn(["tech"])).toBe(true);
  });

  test("carries correct metadata", () => {
    expect(has("tech").operator).toBe("has");
    expect(has("tech").value).toBe("tech");
  });
});

describe("hasAny", () => {
  test("returns true when array contains at least one of the values", () => {
    expect(hasAny(["tech", "finance"]).fn(["tech", "business"])).toBe(true);
  });

  test("returns false when array contains none of the values", () => {
    expect(hasAny(["finance", "crypto"]).fn(["tech", "business"])).toBe(false);
  });

  test("returns false for empty condition array", () => {
    expect(hasAny<string>([]).fn(["tech"])).toBe(false);
  });

  test("returns true when single item is in array", () => {
    expect(hasAny("tech").fn(["tech", "business"])).toBe(true);
  });

  test("returns false when single item is not in array", () => {
    expect(hasAny("finance").fn(["tech", "business"])).toBe(false);
  });

  test("carries correct metadata", () => {
    const items = ["a", "b"];

    expect(hasAny(items).operator).toBe("hasAny");
    expect(hasAny(items).value).toEqual(items);
  });
});

describe("isEmpty", () => {
  test("returns true for empty array", () => {
    expect(isEmpty().fn([])).toBe(true);
  });

  test("returns false for non-empty array", () => {
    expect(isEmpty().fn(["item"])).toBe(false);
  });

  test("returns true for empty string", () => {
    expect(isEmpty().fn("")).toBe(true);
  });

  test("returns false for non-empty string", () => {
    expect(isEmpty().fn("hello")).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(isEmpty().operator).toBe("isEmpty");
  });
});

describe("hasLength", () => {
  test("returns true when array has exact length", () => {
    expect(hasLength(2).fn(["a", "b"])).toBe(true);
  });

  test("returns false when array length differs", () => {
    expect(hasLength(2).fn(["a"])).toBe(false);
  });

  test("returns true when string has exact length", () => {
    expect(hasLength(5).fn("hello")).toBe(true);
  });

  test("supports min constraint", () => {
    expect(hasLength({ min: 2 }).fn(["a", "b", "c"])).toBe(true);
    expect(hasLength({ min: 2 }).fn(["a"])).toBe(false);
  });

  test("supports max constraint", () => {
    expect(hasLength({ max: 3 }).fn(["a", "b"])).toBe(true);
    expect(hasLength({ max: 3 }).fn(["a", "b", "c", "d"])).toBe(false);
  });

  test("supports min and max together", () => {
    expect(hasLength({ min: 1, max: 3 }).fn(["a", "b"])).toBe(true);
    expect(hasLength({ min: 1, max: 3 }).fn([])).toBe(false);
    expect(hasLength({ min: 1, max: 3 }).fn(["a", "b", "c", "d"])).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(hasLength(3).operator).toBe("hasLength");
    expect(hasLength(3).value).toBe(3);
  });
});

describe("isDefined", () => {
  test("returns true for non-null non-undefined values", () => {
    expect(isDefined().fn("hello")).toBe(true);
    expect(isDefined().fn(0)).toBe(true);
    expect(isDefined().fn(false)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isDefined().fn(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isDefined().fn(undefined)).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(isDefined().operator).toBe("isDefined");
  });
});

describe("isNullish", () => {
  test("returns true for null", () => {
    expect(isNullish().fn(null)).toBe(true);
  });

  test("returns true for undefined", () => {
    expect(isNullish().fn(undefined)).toBe(true);
  });

  test("returns false for non-nullish values", () => {
    expect(isNullish().fn("hello")).toBe(false);
    expect(isNullish().fn(0)).toBe(false);
  });

  test("carries correct metadata", () => {
    expect(isNullish().operator).toBe("isNullish");
  });
});

type Post = {
  id: number;
  status: string;
  authorId: number;
  views: number;
  tags: string[];
  title: string;
  publishedAt: Date;
  deletedAt: Date | null | undefined;
};

const base: Post = {
  id: 1,
  status: "draft",
  authorId: 1,
  views: 0,
  tags: [],
  title: "Hello World",
  publishedAt: new Date(),
  deletedAt: null,
};

describe("helpers integrated with Policy", () => {
  test("eq matches condition", () => {
    const policy = new Policy<Post>();
    policy.allow({ action: "read", conditions: { status: eq("draft") } });

    expect(policy.can("read", base)).toMatchObject({ allowed: true });
    expect(policy.can("read", { ...base, status: "published" })).toMatchObject({
      allowed: false,
    });
  });

  test("not(eq) forbids matching value", () => {
    const policy = new Policy<Post>();
    policy.allow({ action: "read", conditions: { authorId: not(eq(999)) } });

    expect(policy.can("read", base)).toMatchObject({ allowed: true });
    expect(policy.can("read", { ...base, authorId: 999 })).toMatchObject({
      allowed: false,
    });
  });

  test("and combines multiple helpers on one field", () => {
    const policy = new Policy<Post>();
    policy.allow({
      action: "read",
      conditions: { views: and(gte(10), lt(100)) },
    });

    expect(policy.can("read", { ...base, views: 50 })).toMatchObject({
      allowed: true,
    });
    expect(policy.can("read", { ...base, views: 5 })).toMatchObject({
      allowed: false,
    });
    expect(policy.can("read", { ...base, views: 100 })).toMatchObject({
      allowed: false,
    });
  });

  test("or allows multiple values on one field", () => {
    const policy = new Policy<Post>();
    policy.allow({
      action: "read",
      conditions: { status: or(eq("draft"), eq("review")) },
    });

    expect(policy.can("read", { ...base, status: "draft" })).toMatchObject({
      allowed: true,
    });
    expect(policy.can("read", { ...base, status: "review" })).toMatchObject({
      allowed: true,
    });
    expect(policy.can("read", { ...base, status: "published" })).toMatchObject({
      allowed: false,
    });
  });

  test("gt on Date field", () => {
    const cutoff = new Date("2025-01-01");
    const policy = new Policy<Post>();
    policy.allow({ action: "read", conditions: { publishedAt: gt(cutoff) } });

    expect(
      policy.can("read", { ...base, publishedAt: new Date("2026-01-01") }),
    ).toMatchObject({ allowed: true });
    expect(
      policy.can("read", { ...base, publishedAt: new Date("2024-01-01") }),
    ).toMatchObject({ allowed: false });
  });

  test("startsWith on string field", () => {
    const policy = new Policy<Post>();
    policy.allow({
      action: "read",
      conditions: { title: startsWith("Hello") },
    });

    expect(policy.can("read", base)).toMatchObject({ allowed: true });
    expect(policy.can("read", { ...base, title: "World Hello" })).toMatchObject(
      { allowed: false },
    );
  });

  test("matches on string field", () => {
    const policy = new Policy<Post>();
    policy.allow({ action: "read", conditions: { title: matches(/^Hello/i) } });

    expect(policy.can("read", base)).toMatchObject({ allowed: true });
    expect(policy.can("read", { ...base, title: "Goodbye" })).toMatchObject({
      allowed: false,
    });
  });

  test("has checks array inclusion (all values)", () => {
    const policy = new Policy<Post>();
    policy.allow({
      action: "read",
      conditions: { tags: has(["tech", "business"]) },
    });

    expect(
      policy.can("read", { ...base, tags: ["tech", "business", "finance"] }),
    ).toMatchObject({ allowed: true });
    expect(policy.can("read", { ...base, tags: ["tech"] })).toMatchObject({
      allowed: false,
    });
  });

  test("hasAny checks array inclusion (any value)", () => {
    const policy = new Policy<Post>();
    policy.allow({
      action: "read",
      conditions: { tags: hasAny(["tech", "finance"]) },
    });

    expect(policy.can("read", { ...base, tags: ["tech"] })).toMatchObject({
      allowed: true,
    });
    expect(policy.can("read", { ...base, tags: ["business"] })).toMatchObject({
      allowed: false,
    });
  });

  test("isNullish allows null/undefined values", () => {
    const policy = new Policy<Post>();
    policy.allow({ action: "delete", conditions: { deletedAt: isNullish() } });

    expect(policy.can("delete", { ...base, deletedAt: null })).toMatchObject({
      allowed: true,
    });
    expect(
      policy.can("delete", { ...base, deletedAt: new Date() }),
    ).toMatchObject({ allowed: false });
  });
});

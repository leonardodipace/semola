import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  any,
  array,
  bigint,
  boolean,
  date,
  enumValues,
  literal,
  never,
  nullable,
  nullish,
  nullType,
  number,
  object,
  optional,
  parse,
  record,
  SchemaError,
  s,
  safeParse,
  string,
  tuple,
  UnsupportedJsonSchemaConversionError,
  UnsupportedJsonSchemaTargetError,
  undefinedType,
  union,
  unknown,
} from "./index.js";

describe("semola/schema", () => {
  test("validates primitives", () => {
    expect(string().parse("hi")).toBe("hi");
    expect(number().parse(3)).toBe(3);
    expect(boolean().parse(true)).toBe(true);
    expect(literal("a").parse("a")).toBe("a");
    expect(nullType().parse(null)).toBe(null);
  });

  test("rejects wrong primitive types", () => {
    expect(() => string().parse(1)).toThrow(SchemaError);
    expect(() => number().parse("1")).toThrow(SchemaError);
    expect(() => boolean().parse("true")).toThrow(SchemaError);
    expect(() => never().parse(1)).toThrow(SchemaError);
  });

  test("supports string refinements", () => {
    const schema = string().min(2).max(5).email();

    expect(schema.parse("a@b.c")).toBe("a@b.c");
    expect(() => schema.parse("a")).toThrow(SchemaError);
    expect(() => schema.parse("not-an-email")).toThrow(SchemaError);
  });

  test("supports number refinements", () => {
    const schema = number().int().min(1).max(10);

    expect(schema.parse(5)).toBe(5);
    expect(() => schema.parse(1.5)).toThrow(SchemaError);
    expect(() => schema.parse(0)).toThrow(SchemaError);
    expect(() => schema.parse(11)).toThrow(SchemaError);
  });

  test("validates objects with optional keys", () => {
    const schema = object({
      name: string(),
      age: number().optional(),
      nickname: optional(string()),
    });

    expect(schema.parse({ name: "Ada" })).toEqual({ name: "Ada" });
    expect(schema.parse({ name: "Ada", age: 36, nickname: "A" })).toEqual({
      name: "Ada",
      age: 36,
      nickname: "A",
    });
    expect(() => schema.parse({})).toThrow(SchemaError);
  });

  test("validates arrays, tuples, records, and unions", () => {
    expect(array(string()).min(1).parse(["a"])).toEqual(["a"]);
    expect(tuple([string(), number()]).parse(["a", 1])).toEqual(["a", 1]);
    expect(record(number()).parse({ a: 1 })).toEqual({ a: 1 });
    expect(union([string(), number()]).parse(2)).toBe(2);
    expect(union([string(), number()]).parse("x")).toBe("x");
    expect(() => union([string(), number()]).parse(true)).toThrow(SchemaError);
  });

  test("supports nullable and nullish", () => {
    expect(nullable(string()).parse(null)).toBe(null);
    expect(nullable(string()).parse("x")).toBe("x");
    expect(nullish(string()).parse(undefined)).toBe(undefined);
    expect(nullish(string()).parse(null)).toBe(null);
    expect(object({ note: nullish(string()) }).parse({})).toEqual({});
  });

  test("supports enums and refine", () => {
    const theme = enumValues(["light", "dark"]);

    expect(theme.parse("light")).toBe("light");
    expect(() => theme.parse("blue")).toThrow(SchemaError);

    const even = number().refine((value) => value % 2 === 0, "Expected even");

    expect(even.parse(2)).toBe(2);
    expect(() => even.parse(3)).toThrow(SchemaError);
  });

  test("safeParse and parse helpers", () => {
    const schema = object({ id: number() });

    const okResult = safeParse(schema, { id: 1 });
    expect(okResult.success).toBe(true);

    if (okResult.success) {
      expect(okResult.data.id).toBe(1);
    }

    const badResult = safeParse(schema, { id: "1" });
    expect(badResult.success).toBe(false);

    expect(parse(schema, { id: 2 })).toEqual({ id: 2 });
  });

  test("implements Standard Schema V1", async () => {
    const schema = object({
      user: object({ email: string().email() }),
      age: number(),
    });

    const standard = schema as StandardSchemaV1;
    expect(standard["~standard"].version).toBe(1);
    expect(standard["~standard"].vendor).toBe("semola");

    const success = standard["~standard"].validate({
      user: { email: "user@example.com" },
      age: 30,
    });

    expect(success).not.toBeInstanceOf(Promise);

    if (success instanceof Promise) {
      throw new Error("expected sync validation");
    }

    if (success.issues) {
      throw new Error("expected success");
    }

    expect(success.value).toEqual({
      user: { email: "user@example.com" },
      age: 30,
    });

    const failure = standard["~standard"].validate({
      user: { email: "bad" },
    });

    expect(failure).not.toBeInstanceOf(Promise);

    if (failure instanceof Promise) {
      throw new Error("expected sync validation");
    }

    expect(failure.issues?.length).toBeGreaterThan(0);
  });

  test("emits JSON Schema for OpenAPI consumers", () => {
    const schema = object({
      name: string().min(1),
      tags: array(string()).optional(),
      status: enumValues(["open", "closed"]),
    });

    const jsonSchema = schema.toJsonSchema();

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.required).toEqual(["name", "status"]);

    const standard = schema["~standard"].jsonSchema.input({
      target: "draft-2020-12",
    });

    expect(standard.type).toBe("object");
  });

  test("accepts any and unknown", () => {
    expect(any().parse({ x: 1 })).toEqual({ x: 1 });
    expect(unknown().parse(undefined)).toBe(undefined);
  });

  test("reports nested issue paths", () => {
    const schema = object({
      user: object({ email: string().email() }),
    });

    const result = schema.safeParse({ user: { email: "bad" } });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.path).toEqual(["user", "email"]);
  });

  test("composites prefix paths for inlined object elements", () => {
    const item = object({ name: string() });

    const arrayResult = array(item).safeParse([{ name: 123 }]);
    expect(arrayResult.success).toBe(false);
    if (!arrayResult.success) {
      expect(arrayResult.error.issues[0]?.path).toEqual([0, "name"]);
    }

    const notObject = array(item).safeParse([5]);
    expect(notObject.success).toBe(false);
    if (!notObject.success) {
      expect(notObject.error.issues[0]?.path).toEqual([0]);
    }

    const nested = object({ items: array(item) }).safeParse({
      items: [{ name: 123 }],
    });
    expect(nested.success).toBe(false);
    if (!nested.success) {
      expect(nested.error.issues[0]?.path).toEqual(["items", 0, "name"]);
    }

    const tupleResult = tuple([item]).safeParse([{ name: 123 }]);
    expect(tupleResult.success).toBe(false);
    if (!tupleResult.success) {
      expect(tupleResult.error.issues[0]?.path).toEqual([0, "name"]);
    }

    const recordResult = record(item).safeParse({ a: { name: 123 } });
    expect(recordResult.success).toBe(false);
    if (!recordResult.success) {
      expect(recordResult.error.issues[0]?.path).toEqual(["a", "name"]);
    }

    const mixed = array(object({ name: string(), d: date() }));
    const mixedName = mixed.safeParse([{ name: 123, d: new Date() }]);
    expect(mixedName.success).toBe(false);
    if (!mixedName.success) {
      expect(mixedName.error.issues[0]?.path).toEqual([0, "name"]);
    }

    const mixedDate = mixed.safeParse([{ name: "ok", d: "not-a-date" }]);
    expect(mixedDate.success).toBe(false);
    if (!mixedDate.success) {
      expect(mixedDate.error.issues[0]?.path).toEqual([0, "d"]);
    }
  });

  test("regex validation resets lastIndex for global patterns", () => {
    const schema = string().regex(/a/g);

    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("a").success).toBe(true);
  });

  test("inlined string and array rules match top-level issue count", () => {
    const nestedString = object({
      name: string().min(5).includes("x"),
    });
    const topString = string().min(5).includes("x");

    expect(nestedString.safeParse({ name: "ab" }).success).toBe(false);
    expect(topString.safeParse("ab").success).toBe(false);

    const nestedIssues = nestedString.safeParse({ name: "ab" });
    const topIssues = topString.safeParse("ab");

    if (nestedIssues.success || topIssues.success) {
      throw new Error("expected failure");
    }

    expect(nestedIssues.error.issues.length).toBe(
      topIssues.error.issues.length,
    );

    const nestedArray = object({ tags: array(string()).min(5) });
    const topArray = array(string()).min(5);
    const nestedArrayResult = nestedArray.safeParse({ tags: ["a", 1] });
    const topArrayResult = topArray.safeParse(["a", 1]);

    if (nestedArrayResult.success || topArrayResult.success) {
      throw new Error("expected failure");
    }

    expect(nestedArrayResult.error.issues.length).toBe(
      topArrayResult.error.issues.length,
    );
  });

  test("regex JSON Schema omits pattern when flags would desync", () => {
    expect(string().regex(/foo/).toJsonSchema().pattern).toBe("foo");
    expect(string().regex(/foo/i).toJsonSchema().pattern).toBeUndefined();
    expect(string().regex(/foo/).regex(/bar/i).toJsonSchema().pattern).toBe(
      "foo",
    );
    expect(string().regex(/foo/i).parse("FOO")).toBe("FOO");
  });

  test("chained regex JSON Schema preserves patterns via allOf", () => {
    const schema = string().regex(/^a/).regex(/b$/).toJsonSchema();

    expect(schema.pattern).toBe("^a");
    expect(schema.allOf).toEqual([{ pattern: "b$" }]);
  });

  test("rejects unsupported JSON Schema targets", () => {
    expect(() => string().toJsonSchema("draft-07")).toThrow(
      UnsupportedJsonSchemaTargetError,
    );
  });

  test("date and bigint reject JSON Schema input conversion", () => {
    expect(() =>
      date()["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
    ).toThrow(UnsupportedJsonSchemaConversionError);

    expect(() =>
      bigint()["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
    ).toThrow(UnsupportedJsonSchemaConversionError);

    expect(() =>
      object({ d: date() })["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      }),
    ).toThrow(UnsupportedJsonSchemaConversionError);

    expect(date().toJsonSchema().format).toBe("date-time");
    expect(bigint().toJsonSchema().type).toBe("integer");
  });

  test("union of objects with literals keeps the matched output", () => {
    const schema = union([
      object({ type: literal("a"), value: string() }),
      object({ type: literal("b"), value: number() }),
    ]);

    expect(schema.parse({ type: "a", value: "hi" })).toEqual({
      type: "a",
      value: "hi",
    });
    expect(schema.parse({ type: "b", value: 2 })).toEqual({
      type: "b",
      value: 2,
    });
  });

  test("refine on object with enum field receives parsed output", () => {
    const schema = object({ s: enumValues(["a", "b"]) }).refine(
      (value) => value.s === "a",
      "Expected a",
    );

    expect(schema.parse({ s: "a" })).toEqual({ s: "a" });
    expect(() => schema.parse({ s: "b" })).toThrow(SchemaError);
  });

  test("s namespace matches named helpers", () => {
    const schema = s.object({
      name: s.string(),
      age: s.int().optional(),
    });

    expect(schema.parse({ name: "Ada" })).toEqual({ name: "Ada" });
    expect(schema.parse({ name: "Ada", age: 36 })).toEqual({
      name: "Ada",
      age: 36,
    });
    expect(() => schema.parse({ name: "Ada", age: 1.5 })).toThrow(SchemaError);
  });

  test("top-level format helpers match method forms", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";

    expect(s.email().parse("a@b.c")).toBe("a@b.c");
    expect(s.url().parse("https://example.com")).toBe("https://example.com");
    expect(s.uuid().parse(id)).toBe(id);
    expect(s.int().parse(3)).toBe(3);

    expect(() => s.email().parse("bad")).toThrow(SchemaError);
    expect(() => s.uuid().parse("not-a-uuid")).toThrow(SchemaError);
    expect(() => s.int().parse(1.5)).toThrow(SchemaError);
  });

  test("object key presence uses own properties only", () => {
    expect(object({ constructor: string() }).safeParse({}).success).toBe(false);
    expect(object({ constructor: any() }).safeParse({}).success).toBe(false);
    expect(object({ valueOf: number().optional() }).safeParse({}).success).toBe(
      true,
    );
    expect(
      object({ constructor: string() }).parse({ constructor: "ok" }),
    ).toEqual({ constructor: "ok" });
  });

  test("uuid JSON Schema includes the runtime pattern", () => {
    const schema = s.uuid().toJsonSchema();

    expect(schema.format).toBe("uuid");
    expect(schema.pattern).toBe(
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    );
  });

  test("literal uses Object.is and rejects non-JSON consts", () => {
    expect(literal(Number.NaN).parse(Number.NaN)).toBe(Number.NaN);
    expect(literal(-0).safeParse(0).success).toBe(false);
    expect(literal(1n).parse(1n)).toBe(1n);

    expect(() => literal(Number.NaN).toJsonSchema()).toThrow(
      UnsupportedJsonSchemaConversionError,
    );
    expect(() => literal(1n).toJsonSchema()).toThrow(
      UnsupportedJsonSchemaConversionError,
    );
    expect(literal("a").toJsonSchema()).toEqual({ const: "a" });
  });

  test("undefinedType rejects JSON Schema conversion", () => {
    expect(() => undefinedType().toJsonSchema()).toThrow(
      UnsupportedJsonSchemaConversionError,
    );
  });

  test("success results are not overwritten by later validates", () => {
    const schema = object({ id: number() });
    const first = schema.safeParse({ id: 1 });
    const second = schema.safeParse({ id: 2 });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    if (first.success) {
      expect(first.data).toEqual({ id: 1 });
    }

    if (second.success) {
      expect(second.data).toEqual({ id: 2 });
    }

    const stdFirst = schema["~standard"].validate({ id: 3 });
    const stdSecond = schema["~standard"].validate({ id: 4 });

    if (stdFirst instanceof Promise || stdSecond instanceof Promise) {
      throw new Error("expected sync validation");
    }

    if (stdFirst.issues || stdSecond.issues) {
      throw new Error("expected success");
    }

    expect(stdFirst.value).toEqual({ id: 3 });
    expect(stdSecond.value).toEqual({ id: 4 });
  });
});

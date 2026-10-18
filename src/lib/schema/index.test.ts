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

  test("regex validation resets lastIndex for global patterns", () => {
    const schema = string().regex(/a/g);

    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("a").success).toBe(true);
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

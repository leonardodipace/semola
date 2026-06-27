import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { validateRequest } from "./request-validator.js";

describe("validateRequest", () => {
  test("returns empty data when schema is omitted", async () => {
    const req = new Request("http://localhost") as Bun.BunRequest;
    const result = await validateRequest({ req });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  test("validates body", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    }) as Bun.BunRequest;

    const result = await validateRequest({
      req,
      schema: { body: z.object({ name: z.string() }) },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toEqual({ name: "Alice" });
    }
  });

  test("returns error on validation failure", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    }) as Bun.BunRequest;

    const result = await validateRequest({
      req,
      schema: { body: z.object({ name: z.string() }) },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("name:");
    }
  });

  test("reuses body cache across validations", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", age: 30 }),
    }) as Bun.BunRequest;

    const bodyCache = { parsed: false, value: undefined as unknown };

    const first = await validateRequest({
      req,
      schema: { body: z.object({ name: z.string() }) },
      bodyCache,
    });

    const second = await validateRequest({
      req,
      schema: { body: z.object({ name: z.string(), age: z.number() }) },
      bodyCache,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(second.data.body).toEqual({ name: "Alice", age: 30 });
    }
  });

  test("validates params", async () => {
    const req = {
      params: { id: "abc" },
    } as unknown as Bun.BunRequest;

    const result = await validateRequest({
      req,
      schema: { params: z.object({ id: z.string() }) },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.params).toEqual({ id: "abc" });
    }
  });
});

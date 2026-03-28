import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateQuery,
  validateSchema,
} from "./index.js";

describe("Validation Module", () => {
  describe("validateSchema", () => {
    test("should format validation errors into a readable string", async () => {
      const schema = z.object({
        user: z.object({
          email: z.email(),
        }),
        age: z.number(),
      });

      let caughtError: unknown;

      try {
        await validateSchema(schema, {
          user: { email: "invalid" },
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(Error);
      if (!(caughtError instanceof Error)) {
        throw new Error("Expected Error instance");
      }

      expect(caughtError.message).toContain("user.email:");
      expect(caughtError.message).toContain("age:");
    });
  });

  describe("validateBody", () => {
    test("should validate JSON body and return parsed data", async () => {
      const schema = z.object({ id: z.number() });
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 123 }),
      });

      const data = await validateBody(req, schema);
      expect(data).toEqual({ id: 123 });
    });

    test("should return ParseError for malformed JSON", async () => {
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ invalid json }",
      });

      await expect(validateBody(req, z.any())).rejects.toMatchObject({
        name: "ParseError",
      });
    });

    test("should skip validation if Content-Type is not JSON", async () => {
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      });

      const data = await validateBody(req, z.string());
      expect(data).toBeUndefined();
    });

    test("should cache parsed body and reuse on subsequent calls", async () => {
      const schema = z.object({ name: z.string() });
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });

      const bodyCache = { parsed: false, value: undefined as unknown };

      const data1 = await validateBody(req, schema, bodyCache);
      expect(data1).toEqual({ name: "test" });
      expect(bodyCache.parsed).toBe(true);
      expect(bodyCache.value).toEqual({ name: "test" });

      // Second call should use cached value (would fail without cache since body is consumed)
      const data2 = await validateBody(req, schema, bodyCache);
      expect(data2).toEqual({ name: "test" });
    });

    test("should validate cached body against different schemas", async () => {
      const partialSchema = z.object({ name: z.string() });
      const fullSchema = z.object({ name: z.string(), age: z.number() });
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test", age: 25 }),
      });

      const bodyCache = { parsed: false, value: undefined as unknown };

      // First validation with partial schema
      const data1 = await validateBody(req, partialSchema, bodyCache);
      expect(data1).toEqual({ name: "test" });

      // Second validation with full schema using cached body
      const data2 = await validateBody(req, fullSchema, bodyCache);
      expect(data2).toEqual({ name: "test", age: 25 });
    });
  });

  describe("validateQuery", () => {
    test("should handle single and multiple query parameters", async () => {
      const schema = z.object({
        filter: z.string(),
        tags: z.array(z.string()),
      });
      const req = new Request("http://localhost?filter=active&tags=a&tags=b");

      const data = await validateQuery(req, schema);
      expect(data).toEqual({ filter: "active", tags: ["a", "b"] });
    });
  });

  describe("validateHeaders", () => {
    test("should validate normalized lowercase headers", async () => {
      const schema = z.object({
        "x-api-key": z.string(),
      });
      const req = new Request("http://localhost", {
        headers: { "X-API-KEY": "secret-123" },
      });

      const data = await validateHeaders(req, schema);
      expect(data).toEqual({ "x-api-key": "secret-123" });
    });
  });

  describe("validateCookies", () => {
    test("should parse and validate cookies", async () => {
      const schema = z.object({
        theme: z.enum(["light", "dark"]),
        session: z.string(),
      });
      const req = new Request("http://localhost", {
        headers: { cookie: "theme=dark; session=abc" },
      });

      const data = await validateCookies(req, schema);
      expect(data).toEqual({ theme: "dark", session: "abc" });
    });

    test("should return error when required cookie is missing", async () => {
      const schema = z.object({ requiredCookie: z.string() });
      const req = new Request("http://localhost");

      await expect(validateCookies(req, schema)).rejects.toMatchObject({
        message: expect.stringContaining("requiredCookie:"),
      });
    });
  });
});

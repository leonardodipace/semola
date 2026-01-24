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
          email: z.string().email(),
        }),
        age: z.number(),
      });

      const [error, data] = await validateSchema(schema, {
        user: { email: "invalid" },
      });

      expect(data).toBeNull();
      expect(error?.message).toContain("user.email: Invalid email");
      expect(error?.message).toContain("age: Required");
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

      const [error, data] = await validateBody(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ id: 123 });
    });

    test("should return ParseError for malformed JSON", async () => {
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ invalid json }",
      });

      const [error] = await validateBody(req, z.any());
      expect(error?.type).toBe("ParseError");
    });

    test("should skip validation if Content-Type is not JSON", async () => {
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      });

      const [error, data] = await validateBody(req, z.string());
      expect(error).toBeNull();
      expect(data).toBeUndefined();
    });
  });

  describe("validateQuery", () => {
    test("should handle single and multiple query parameters", async () => {
      const schema = z.object({
        filter: z.string(),
        tags: z.array(z.string()),
      });
      const req = new Request("http://localhost?filter=active&tags=a&tags=b");

      const [error, data] = await validateQuery(req, schema);

      expect(error).toBeNull();
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

      const [error, data] = await validateHeaders(req, schema);

      expect(error).toBeNull();
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

      const [error, data] = await validateCookies(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ theme: "dark", session: "abc" });
    });

    test("should return error when required cookie is missing", async () => {
      const schema = z.object({ requiredCookie: z.string() });
      const req = new Request("http://localhost");

      const [error] = await validateCookies(req, schema);
      expect(error?.message).toContain("requiredCookie: Required");
    });
  });
});

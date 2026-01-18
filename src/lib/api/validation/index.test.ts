import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateQuery,
  validateSchema,
} from "./index.js";

// Helper to create a mock schema that succeeds
const createSuccessSchema = <T>(value: T): StandardSchemaV1 => ({
  "~standard": {
    version: 1,
    vendor: "mock",
    validate: async () => ({ value }),
  },
});

// Helper to create a mock schema that fails
const createFailSchema = (
  issues: Array<{ path?: unknown[]; message?: string }>,
): StandardSchemaV1 => ({
  "~standard": {
    version: 1,
    vendor: "mock",
    validate: async () => ({ issues }) as any,
  },
});

// Helper to create a test Request
const createTestRequest = (options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Request => {
  const url = options.url || "http://localhost:3000/test";
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});

  return new Request(url, {
    method,
    headers,
    body: options.body,
  });
};

describe("Validation Module", () => {
  describe("validateSchema", () => {
    test("should return ok tuple when validation succeeds", async () => {
      const schema = createSuccessSchema({ name: "John", age: 30 });
      const [error, data] = await validateSchema(schema, {
        name: "John",
        age: 30,
      });

      expect(error).toBeNull();
      expect(data).toEqual({ name: "John", age: 30 });
    });

    test("should return error tuple when validation fails", async () => {
      const schema = createFailSchema([
        { path: ["name"], message: "name is required" },
      ]);
      const [error, data] = await validateSchema(schema, {});

      expect(error).toEqual({
        type: "ValidationError",
        message: "name: name is required",
      });
      expect(data).toBeNull();
    });

    test("should format multiple issues correctly", async () => {
      const schema = createFailSchema([
        { path: ["name"], message: "name is required" },
        { path: ["email"], message: "invalid email" },
      ]);
      const [error, data] = await validateSchema(schema, {});

      expect(error).toEqual({
        type: "ValidationError",
        message: "name: name is required, email: invalid email",
      });
      expect(data).toBeNull();
    });

    test("should handle nested paths", async () => {
      const schema = createFailSchema([
        { path: ["user", "profile", "name"], message: "name is required" },
      ]);
      const [error, data] = await validateSchema(schema, {});

      expect(error).toEqual({
        type: "ValidationError",
        message: "user.profile.name: name is required",
      });
      expect(data).toBeNull();
    });

    test("should handle non-array paths", async () => {
      const schema = createFailSchema([{ message: "validation failed" }]);
      const [error, data] = await validateSchema(schema, {});

      expect(error).toEqual({
        type: "ValidationError",
        message: "unknown: validation failed",
      });
      expect(data).toBeNull();
    });

    test("should handle missing error message", async () => {
      const schema = createFailSchema([{ path: ["field"] }]);
      const [error, data] = await validateSchema(schema, {});

      expect(error).toEqual({
        type: "ValidationError",
        message: "field: validation failed",
      });
      expect(data).toBeNull();
    });

    test("should handle empty path array", async () => {
      const schema = createFailSchema([{ path: [], message: "root error" }]);
      const [error, data] = await validateSchema(schema, {});

      expect(error?.message).toBe(": root error");
      expect(data).toBeNull();
    });
  });

  describe("validateBody", () => {
    test("should return undefined when no schema provided", async () => {
      const req = createTestRequest({
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "John" }),
      });

      const [error, data] = await validateBody(req);

      expect(error).toBeNull();
      expect(data).toBeUndefined();
    });

    test("should return undefined when content-type is not JSON", async () => {
      const schema = createSuccessSchema({ name: "John" });
      const req = createTestRequest({
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ name: "John" }),
      });

      const [error, data] = await validateBody(req, schema);

      expect(error).toBeNull();
      expect(data).toBeUndefined();
    });

    test("should return undefined when content-type header is missing", async () => {
      const schema = createSuccessSchema({ name: "John" });
      const req = createTestRequest({
        body: JSON.stringify({ name: "John" }),
      });

      const [error, data] = await validateBody(req, schema);

      expect(error).toBeNull();
      expect(data).toBeUndefined();
    });

    test("should validate JSON body successfully", async () => {
      const schema = createSuccessSchema({ name: "John", age: 30 });
      const req = createTestRequest({
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "John", age: 30 }),
      });

      const [error, data] = await validateBody(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ name: "John", age: 30 });
    });

    test("should handle content-type with charset", async () => {
      const schema = createSuccessSchema({ name: "John" });
      const req = createTestRequest({
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ name: "John" }),
      });

      const [error, data] = await validateBody(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ name: "John" });
    });

    test("should return ParseError for invalid JSON", async () => {
      const schema = createSuccessSchema({ name: "John" });
      const req = createTestRequest({
        headers: { "content-type": "application/json" },
        body: "invalid json {",
      });

      const [error, data] = await validateBody(req, schema);

      expect(error).toEqual({
        type: "ParseError",
        message: "Invalid JSON body",
      });
      expect(data).toBeNull();
    });

    test("should return ValidationError when schema validation fails", async () => {
      const schema = createFailSchema([
        { path: ["name"], message: "name is required" },
      ]);
      const req = createTestRequest({
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      const [error, data] = await validateBody(req, schema);

      expect(error).toEqual({
        type: "ValidationError",
        message: "name: name is required",
      });
      expect(data).toBeNull();
    });

    test("should handle empty JSON body", async () => {
      const schema = createSuccessSchema({});
      const req = createTestRequest({
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      const [error, data] = await validateBody(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({});
    });
  });

  describe("validateQuery", () => {
    test("should return undefined when no schema provided", async () => {
      const req = createTestRequest({
        url: "http://localhost:3000/test?name=John&age=30",
      });

      const [error, data] = await validateQuery(req);

      expect(error).toBeNull();
      expect(data).toBeUndefined();
    });

    test("should validate single query parameters as strings", async () => {
      const schema = createSuccessSchema({ name: "John", age: "30" });
      const req = createTestRequest({
        url: "http://localhost:3000/test?name=John&age=30",
      });

      const [error, data] = await validateQuery(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ name: "John", age: "30" });
    });

    test("should handle multiple values for same key", async () => {
      const schema = createSuccessSchema({ tags: ["a", "b", "c"] });
      const req = createTestRequest({
        url: "http://localhost:3000/test?tags=a&tags=b&tags=c",
      });

      const [error, data] = await validateQuery(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ tags: ["a", "b", "c"] });
    });

    test("should handle empty query string", async () => {
      const schema = createSuccessSchema({});
      const req = createTestRequest({
        url: "http://localhost:3000/test",
      });

      const [error, data] = await validateQuery(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    test("should handle special characters in query params", async () => {
      const schema = createSuccessSchema({
        search: "hello world",
        email: "test@example.com",
      });
      const req = createTestRequest({
        url: "http://localhost:3000/test?search=hello%20world&email=test%40example.com",
      });

      const [error, data] = await validateQuery(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({
        search: "hello world",
        email: "test@example.com",
      });
    });

    test("should return ValidationError when schema validation fails", async () => {
      const schema = createFailSchema([
        { path: ["name"], message: "name is required" },
      ]);
      const req = createTestRequest({
        url: "http://localhost:3000/test",
      });

      const [error, data] = await validateQuery(req, schema);

      expect(error).toEqual({
        type: "ValidationError",
        message: "name: name is required",
      });
      expect(data).toBeNull();
    });

    test("should handle query params with empty values", async () => {
      const schema = createSuccessSchema({ name: "" });
      const req = createTestRequest({
        url: "http://localhost:3000/test?name=",
      });

      const [error, data] = await validateQuery(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ name: "" });
    });

    test("should return string for single value and array for multiple values", async () => {
      const schema = createSuccessSchema({
        single: "value",
        multiple: ["a", "b"],
      });
      const req = createTestRequest({
        url: "http://localhost:3000/test?single=value&multiple=a&multiple=b",
      });

      const [error, data] = await validateQuery(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({
        single: "value",
        multiple: ["a", "b"],
      });
    });
  });

  describe("validateHeaders", () => {
    test("should return undefined when no schema provided", async () => {
      const req = createTestRequest({
        headers: { "Content-Type": "application/json" },
      });

      const [error, data] = await validateHeaders(req);

      expect(error).toBeNull();
      expect(data).toBeUndefined();
    });

    test("should validate headers with lowercase keys", async () => {
      const schema = createSuccessSchema({
        "content-type": "application/json",
        authorization: "Bearer token",
      });
      const req = createTestRequest({
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
      });

      const [error, data] = await validateHeaders(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({
        "content-type": "application/json",
        authorization: "Bearer token",
      });
    });

    test("should normalize header keys to lowercase", async () => {
      const schema = createSuccessSchema({
        "x-custom-header": "value",
      });
      const req = createTestRequest({
        headers: { "X-Custom-Header": "value" },
      });

      const [error, data] = await validateHeaders(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ "x-custom-header": "value" });
    });

    test("should handle empty headers", async () => {
      const schema = createSuccessSchema({});
      const req = createTestRequest({});

      const [error, data] = await validateHeaders(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    test("should return ValidationError when schema validation fails", async () => {
      const schema = createFailSchema([
        { path: ["authorization"], message: "authorization header required" },
      ]);
      const req = createTestRequest({});

      const [error, data] = await validateHeaders(req, schema);

      expect(error).toEqual({
        type: "ValidationError",
        message: "authorization: authorization header required",
      });
      expect(data).toBeNull();
    });

    test("should handle multiple headers", async () => {
      const schema = createSuccessSchema({
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "test-client",
      });
      const req = createTestRequest({
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "User-Agent": "test-client",
        },
      });

      const [error, data] = await validateHeaders(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "test-client",
      });
    });
  });

  describe("validateCookies", () => {
    test("should return undefined when no schema provided", async () => {
      const req = createTestRequest({
        headers: { cookie: "session=abc123" },
      });

      const [error, data] = await validateCookies(req);

      expect(error).toBeNull();
      expect(data).toBeUndefined();
    });

    test("should validate single cookie", async () => {
      const schema = createSuccessSchema({ session: "abc123" });
      const req = createTestRequest({
        headers: { cookie: "session=abc123" },
      });

      const [error, data] = await validateCookies(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ session: "abc123" });
    });

    test("should validate multiple cookies", async () => {
      const schema = createSuccessSchema({
        session: "abc123",
        user: "john",
        theme: "dark",
      });
      const req = createTestRequest({
        headers: { cookie: "session=abc123; user=john; theme=dark" },
      });

      const [error, data] = await validateCookies(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({
        session: "abc123",
        user: "john",
        theme: "dark",
      });
    });

    test("should handle empty cookie header", async () => {
      const schema = createSuccessSchema({});
      const req = createTestRequest({});

      const [error, data] = await validateCookies(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    test("should handle missing cookie header", async () => {
      const schema = createSuccessSchema({});
      const req = createTestRequest({});

      const [error, data] = await validateCookies(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    test("should return ValidationError when schema validation fails", async () => {
      const schema = createFailSchema([
        { path: ["session"], message: "session cookie required" },
      ]);
      const req = createTestRequest({});

      const [error, data] = await validateCookies(req, schema);

      expect(error).toEqual({
        type: "ValidationError",
        message: "session: session cookie required",
      });
      expect(data).toBeNull();
    });

    test("should handle cookies with special characters", async () => {
      const schema = createSuccessSchema({
        data: "value%20with%20spaces",
      });
      const req = createTestRequest({
        headers: { cookie: "data=value%20with%20spaces" },
      });

      const [error, data] = await validateCookies(req, schema);

      expect(error).toBeNull();
      expect(data).toEqual({ data: "value%20with%20spaces" });
    });
  });
});

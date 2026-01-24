import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Middleware } from "./index.js";

// Helper to create a simple mock schema
const createMockSchema = (): StandardSchemaV1 => ({
  "~standard": {
    version: 1,
    vendor: "mock",
    validate: async (data: unknown) => ({ value: data }),
  },
});

describe("Middleware", () => {
  describe("constructor", () => {
    test("should create middleware with handler only", () => {
      const handler = () => ({ user: "test" });
      const middleware = new Middleware({ handler });

      expect(middleware.options).toMatchObject({ handler });
      expect(middleware.options.request).toBeUndefined();
      expect(middleware.options.response).toBeUndefined();
    });

    test("should create middleware with request schema", () => {
      const schema = createMockSchema();
      const handler = () => ({ user: "test" });
      const middleware = new Middleware({
        request: { body: schema },
        handler,
      });

      expect(middleware.options.handler).toBe(handler);
      expect(middleware.options.request).toEqual({ body: schema });
    });

    test("should create middleware with response schema", () => {
      const schema = createMockSchema();
      const handler = () => ({ user: "test" });
      const middleware = new Middleware({
        response: { 200: schema },
        handler,
      });

      expect(middleware.options.handler).toBe(handler);
      expect(middleware.options.response).toEqual({ 200: schema });
    });

    test("should create middleware with both request and response schemas", () => {
      const requestSchema = createMockSchema();
      const responseSchema = createMockSchema();
      const handler = () => ({ user: "test" });

      const middleware = new Middleware({
        request: { body: requestSchema },
        response: { 200: responseSchema },
        handler,
      });

      expect(middleware.options.handler).toBe(handler);
      expect(middleware.options.request).toEqual({ body: requestSchema });
      expect(middleware.options.response).toEqual({ 200: responseSchema });
    });

    test("should create middleware with extension type", () => {
      type Extension = { user: string; role: string };
      const handler = (): Extension => ({ user: "test", role: "admin" });

      const middleware = new Middleware<
        { body?: StandardSchemaV1 },
        { 200: StandardSchemaV1 },
        Extension
      >({
        handler,
      });

      expect(middleware.options.handler).toBe(handler);
    });

    test("should store options correctly", () => {
      const options = {
        request: { body: createMockSchema() },
        response: { 200: createMockSchema() },
        handler: () => ({ data: "test" }),
      };

      const middleware = new Middleware(options);

      expect(middleware.options).toEqual(options);
    });

    test("should handle async handler", () => {
      const handler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { user: "test" };
      };

      const middleware = new Middleware({ handler });

      expect(middleware.options.handler).toBe(handler);
    });

    test("should handle handler returning Response", () => {
      const handler = () => new Response("Unauthorized", { status: 401 });
      const middleware = new Middleware({ handler });

      expect(middleware.options.handler).toBe(handler);
    });

    test("should handle handler returning void", () => {
      const handler = () => undefined as any;
      const middleware = new Middleware({ handler });

      expect(middleware.options.handler).toBe(handler);
    });

    test("should preserve all request schema properties", () => {
      const bodySchema = createMockSchema();
      const querySchema = createMockSchema();
      const headersSchema = createMockSchema();
      const cookiesSchema = createMockSchema();

      const middleware = new Middleware({
        request: {
          body: bodySchema,
          query: querySchema,
          headers: headersSchema,
          cookies: cookiesSchema,
        },
        handler: () => ({}),
      });

      expect(middleware.options.request?.body).toBe(bodySchema);
      expect(middleware.options.request?.query).toBe(querySchema);
      expect(middleware.options.request?.headers).toBe(headersSchema);
      expect(middleware.options.request?.cookies).toBe(cookiesSchema);
    });

    test("should preserve all response schema status codes", () => {
      const schema200 = createMockSchema();
      const schema400 = createMockSchema();
      const schema500 = createMockSchema();

      const middleware = new Middleware({
        response: {
          200: schema200,
          400: schema400,
          500: schema500,
        },
        handler: () => ({}),
      });

      expect(middleware.options.response?.[200]).toBe(schema200);
      expect(middleware.options.response?.[400]).toBe(schema400);
      expect(middleware.options.response?.[500]).toBe(schema500);
    });
  });
});

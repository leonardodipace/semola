import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Middleware } from "../middleware/index.js";
import { Api } from "./index.js";

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

describe("Api Core", () => {
  describe("constructor", () => {
    test("should create Api instance with no options", () => {
      const api = new Api({});
      expect(api).toBeInstanceOf(Api);
    });

    test("should create Api instance with prefix", () => {
      const api = new Api({ prefix: "/api/v1" });
      expect(api).toBeInstanceOf(Api);
    });

    test("should create Api instance with openapi options", () => {
      const api = new Api({
        openapi: {
          version: "1.0.0",
          title: "Test API",
          description: "A test API",
        },
      });
      expect(api).toBeInstanceOf(Api);
    });

    test("should create Api instance with middlewares", () => {
      const middleware = new Middleware({
        handler: () => ({ user: "test" }),
      });

      const api = new Api({ middlewares: [middleware] });
      expect(api).toBeInstanceOf(Api);
    });

    test("should create Api instance with all options", () => {
      const middleware = new Middleware({
        handler: () => ({ user: "test" }),
      });

      const api = new Api({
        prefix: "/api",
        openapi: {
          version: "1.0.0",
          title: "Test API",
          description: "Test",
        },
        middlewares: [middleware],
      });

      expect(api).toBeInstanceOf(Api);
    });
  });

  describe("defineRoute", () => {
    test("should register a simple route", () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
      });

      expect(api).toBeInstanceOf(Api);
    });

    test("should register multiple routes", () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
      });

      api.defineRoute({
        path: "/posts",
        method: "GET",
        response: { 200: createSuccessSchema({ posts: [] }) },
        handler: (c) => c.json(200, { posts: [] }),
      });

      expect(api).toBeInstanceOf(Api);
    });

    test("should register routes with different methods on same path", () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
      });

      api.defineRoute({
        path: "/users",
        method: "POST",
        request: { body: createSuccessSchema({ name: "test" }) },
        response: { 201: createSuccessSchema({ id: "1" }) },
        handler: (c) => c.json(201, { id: "1" }),
      });

      expect(api).toBeInstanceOf(Api);
    });

    test("should register route with request schemas", () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "POST",
        request: {
          body: createSuccessSchema({ name: "John" }),
          query: createSuccessSchema({ page: ["1"] }),
          headers: createSuccessSchema({ "content-type": "application/json" }),
          cookies: createSuccessSchema({ session: "abc" }),
        },
        response: { 201: createSuccessSchema({ id: "1" }) },
        handler: (c) => c.json(201, { id: "1" }),
      });

      expect(api).toBeInstanceOf(Api);
    });

    test("should register route with metadata", () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
        summary: "Get all users",
        description: "Returns a list of all users",
        operationId: "getAllUsers",
        tags: ["Users"],
      });

      expect(api).toBeInstanceOf(Api);
    });

    test("should register route with middlewares", () => {
      const api = new Api({});
      const middleware = new Middleware({
        handler: () => ({ user: "test" }),
      });

      api.defineRoute({
        path: "/protected",
        method: "GET",
        response: { 200: createSuccessSchema({ data: "secret" }) },
        middlewares: [middleware],
        handler: (c) => c.json(200, { data: "secret" }),
      });

      expect(api).toBeInstanceOf(Api);
    });
  });

  describe("integration - end-to-end routes", () => {
    test("should handle GET request with query validation", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "GET",
        request: {
          query: createSuccessSchema({ page: ["1"], limit: ["10"] }),
        },
        response: { 200: createSuccessSchema({ users: [], page: 1 }) },
        handler: (c) => {
          return c.json(200, { users: [], page: 1 });
        },
      });

      let server: any = null;

      api.serve(3001, (s) => {
        server = s;
      });

      const response = await fetch(
        "http://localhost:3001/users?page=1&limit=10",
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ users: [], page: 1 });

      server?.stop();
    });

    test("should handle POST request with body validation", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "POST",
        request: {
          body: createSuccessSchema({
            name: "John",
            email: "john@example.com",
          }),
        },
        response: { 201: createSuccessSchema({ id: "1", name: "John" }) },
        handler: (c) => {
          return c.json(201, { id: "1", name: (c.req.body as any).name });
        },
      });

      let server: any = null;

      api.serve(3002, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3002/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "John", email: "john@example.com" }),
      });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toEqual({ id: "1", name: "John" });

      server?.stop();
    });

    test("should return 400 for validation errors", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "POST",
        request: {
          body: createFailSchema([
            { path: ["name"], message: "name is required" },
          ]),
        },
        response: { 201: createSuccessSchema({ id: "1" }) },
        handler: (c) => c.json(201, { id: "1" }),
      });

      let server: any = null;

      api.serve(3003, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3003/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ message: "name: name is required" });

      server?.stop();
    });

    test("should handle routes with path prefix", async () => {
      const api = new Api({ prefix: "/api/v1" });

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
      });

      let server: any = null;

      api.serve(3004, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3004/api/v1/users");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ users: [] });

      server?.stop();
    });

    test("should handle prefix without trailing slash", async () => {
      const api = new Api({ prefix: "/api/v1" });

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
      });

      let server: any = null;

      api.serve(3005, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3005/api/v1/users");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ users: [] });

      server?.stop();
    });

    test("should handle text responses", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/health",
        method: "GET",
        response: { 200: createSuccessSchema("ok") },
        handler: (c) => c.text(200, "healthy"),
      });

      let server: any = null;

      api.serve(3006, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3006/health");
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toBe("healthy");

      server?.stop();
    });

    test("should handle headers validation", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/protected",
        method: "GET",
        request: {
          headers: createSuccessSchema({
            authorization: "Bearer token123",
          }),
        },
        response: { 200: createSuccessSchema({ data: "secret" }) },
        handler: (c) => c.json(200, { data: "secret" }),
      });

      let server: any = null;

      api.serve(3007, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3007/protected", {
        headers: { authorization: "Bearer token123" },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ data: "secret" });

      server?.stop();
    });

    test("should handle cookies validation", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/profile",
        method: "GET",
        request: {
          cookies: createSuccessSchema({ session: "abc123" }),
        },
        response: { 200: createSuccessSchema({ user: "John" }) },
        handler: (c) => c.json(200, { user: "John" }),
      });

      let server: any = null;

      api.serve(3008, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3008/profile", {
        headers: { cookie: "session=abc123" },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ user: "John" });

      server?.stop();
    });

    test("should return 404 for undefined routes", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
      });

      let server: any = null;

      api.serve(3009, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3009/posts");
      const text = await response.text();

      expect(response.status).toBe(404);
      expect(text).toBe("Not found");

      server?.stop();
    });
  });

  describe("middleware integration", () => {
    test("should execute global middleware", async () => {
      const authMiddleware = new Middleware({
        handler: () => ({ user: { id: "1", name: "John" } }),
      });

      const api = new Api({ middlewares: [authMiddleware] });

      api.defineRoute({
        path: "/profile",
        method: "GET",
        response: {
          200: createSuccessSchema({ user: { id: "1", name: "John" } }),
        },
        middlewares: [authMiddleware] as const,
        handler: (c) => {
          const user = c.get("user");
          return c.json(200, { user });
        },
      });

      let server: any = null;

      api.serve(3010, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3010/profile");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ user: { id: "1", name: "John" } });

      server?.stop();
    });

    test("should execute route-specific middleware", async () => {
      const roleMiddleware = new Middleware({
        handler: () => ({ role: "admin" }),
      });

      const api = new Api({});

      api.defineRoute({
        path: "/admin",
        method: "GET",
        response: { 200: createSuccessSchema({ role: "admin" }) },
        middlewares: [roleMiddleware] as const,
        handler: (c) => {
          const role = c.get("role");
          return c.json(200, { role });
        },
      });

      let server: any = null;

      api.serve(3011, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3011/admin");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ role: "admin" });

      server?.stop();
    });

    test("should execute global and route middlewares in order", async () => {
      const globalMiddleware = new Middleware({
        handler: () => ({ globalData: "global" }),
      });

      const routeMiddleware = new Middleware({
        handler: () => ({ routeData: "route" }),
      });

      const api = new Api({ middlewares: [globalMiddleware] });

      api.defineRoute({
        path: "/test",
        method: "GET",
        response: {
          200: createSuccessSchema({
            globalData: "global",
            routeData: "route",
          }),
        },
        middlewares: [globalMiddleware, routeMiddleware] as const,
        handler: (c) => {
          const globalData = c.get("globalData");
          const routeData = c.get("routeData");
          return c.json(200, { globalData, routeData });
        },
      });

      let server: any = null;

      api.serve(3012, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3012/test");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ globalData: "global", routeData: "route" });

      server?.stop();
    });

    test("should short-circuit when middleware returns Response", async () => {
      const authMiddleware = new Middleware({
        handler: (c) => c.json(401, { error: "Unauthorized" }),
      });

      const api = new Api({});

      api.defineRoute({
        path: "/protected",
        method: "GET",
        response: { 200: createSuccessSchema({ data: "secret" }) },
        middlewares: [authMiddleware],
        handler: (c) => c.json(200, { data: "secret" }),
      });

      let server: any = null;

      api.serve(3013, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3013/protected");
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });

      server?.stop();
    });

    test("should return 400 when middleware validation fails", async () => {
      const authMiddleware = new Middleware({
        request: {
          headers: createFailSchema([
            {
              path: ["authorization"],
              message: "Authorization header required",
            },
          ]),
        },
        handler: () => ({ user: "test" }),
      });

      const api = new Api({});

      api.defineRoute({
        path: "/protected",
        method: "GET",
        response: { 200: createSuccessSchema({ data: "secret" }) },
        middlewares: [authMiddleware],
        handler: (c) => c.json(200, { data: "secret" }),
      });

      let server: any = null;

      api.serve(3014, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3014/protected");
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        message: "authorization: Authorization header required",
      });

      server?.stop();
    });

    test("should handle multiple middlewares with extensions", async () => {
      const mw1 = new Middleware({
        handler: () => ({ data1: "value1" }),
      });

      const mw2 = new Middleware({
        handler: () => ({ data2: "value2" }),
      });

      const mw3 = new Middleware({
        handler: () => ({ data3: "value3" }),
      });

      const api = new Api({});

      api.defineRoute({
        path: "/test",
        method: "GET",
        response: {
          200: createSuccessSchema({
            data1: "value1",
            data2: "value2",
            data3: "value3",
          }),
        },
        middlewares: [mw1, mw2, mw3] as const,
        handler: (c) => {
          return c.json(200, {
            data1: c.get("data1"),
            data2: c.get("data2"),
            data3: c.get("data3"),
          });
        },
      });

      let server: any = null;

      api.serve(3015, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3015/test");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        data1: "value1",
        data2: "value2",
        data3: "value3",
      });

      server?.stop();
    });

    test("should validate middleware request schemas", async () => {
      const authMiddleware = new Middleware({
        request: {
          headers: createSuccessSchema({ authorization: "Bearer token" }),
        },
        handler: () => ({ authenticated: true }),
      });

      const api = new Api({});

      api.defineRoute({
        path: "/protected",
        method: "GET",
        response: { 200: createSuccessSchema({ authenticated: true }) },
        middlewares: [authMiddleware] as const,
        handler: (c) => {
          const authenticated = c.get("authenticated");
          return c.json(200, { authenticated });
        },
      });

      let server: any = null;

      api.serve(3016, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3016/protected", {
        headers: { authorization: "Bearer token" },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ authenticated: true });

      server?.stop();
    });
  });

  describe("context methods", () => {
    test("should provide access to raw request", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/raw",
        method: "GET",
        response: { 200: createSuccessSchema({ method: "GET" }) },
        handler: (c) => {
          return c.json(200, { method: c.raw.method });
        },
      });

      let server: any = null;

      api.serve(3017, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3017/raw");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ method: "GET" });

      server?.stop();
    });

    test("should provide validated request data", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users",
        method: "POST",
        request: {
          body: createSuccessSchema({ name: "John", age: 30 }),
        },
        response: { 201: createSuccessSchema({ name: "John", age: 30 }) },
        handler: (c) => {
          return c.json(201, {
            name: (c.req.body as any).name,
            age: (c.req.body as any).age,
          });
        },
      });

      let server: any = null;

      api.serve(3018, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3018/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "John", age: 30 }),
      });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toEqual({ name: "John", age: 30 });

      server?.stop();
    });

    test("should handle multiple response status codes", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/users/success",
        method: "GET",
        response: {
          200: createSuccessSchema({ id: "1", name: "John" }),
        },
        handler: (c) => {
          return c.json(200, { id: "1", name: "John" });
        },
      });

      api.defineRoute({
        path: "/users/notfound",
        method: "GET",
        response: {
          404: createSuccessSchema({ message: "User not found" }),
        },
        handler: (c) => {
          return c.json(404, { message: "User not found" });
        },
      });

      let server: any = null;

      api.serve(3019, (s) => {
        server = s;
      });

      const response1 = await fetch("http://localhost:3019/users/success");
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1).toEqual({ id: "1", name: "John" });

      const response2 = await fetch("http://localhost:3019/users/notfound");
      const data2 = await response2.json();

      expect(response2.status).toBe(404);
      expect(data2).toEqual({ message: "User not found" });

      server?.stop();
    });
  });

  describe("edge cases", () => {
    test("should handle routes without request schemas", async () => {
      const api = new Api({});

      api.defineRoute({
        path: "/simple",
        method: "GET",
        response: { 200: createSuccessSchema({ message: "hello" }) },
        handler: (c) => c.json(200, { message: "hello" }),
      });

      let server: any = null;

      api.serve(3020, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3020/simple");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: "hello" });

      server?.stop();
    });

    test("should handle routes with empty path prefix", async () => {
      const api = new Api({ prefix: "" });

      api.defineRoute({
        path: "/users",
        method: "GET",
        response: { 200: createSuccessSchema({ users: [] }) },
        handler: (c) => c.json(200, { users: [] }),
      });

      let server: any = null;

      api.serve(3021, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3021/users");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ users: [] });

      server?.stop();
    });

    test("should handle middleware that returns undefined", async () => {
      const middleware = new Middleware({
        handler: () => undefined as any,
      });

      const api = new Api({});

      api.defineRoute({
        path: "/test",
        method: "GET",
        response: { 200: createSuccessSchema({ message: "ok" }) },
        middlewares: [middleware],
        handler: (c) => c.json(200, { message: "ok" }),
      });

      let server: any = null;

      api.serve(3022, (s) => {
        server = s;
      });

      const response = await fetch("http://localhost:3022/test");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: "ok" });

      server?.stop();
    });
  });
});

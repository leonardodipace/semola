import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { z } from "zod";
import { Api, Middleware } from "./index.js";

let testServer: Server<unknown> | null = null;
let currentPort = 4000;

const getNextPort = () => {
  currentPort += 1;
  return currentPort;
};

const createTestServer = (api: Api) => {
  const port = getNextPort();
  testServer = api.listen(port);
  return { port, baseUrl: `http://localhost:${port}` };
};

const fetchJson = async <T = unknown>(url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  return response.json() as Promise<T>;
};

afterEach(() => {
  testServer?.stop();
  testServer = null;
});

describe("Middleware", () => {
  test("should create middleware instance", () => {
    const middleware = new Middleware({
      handler: async (_c) => ({ data: "test" }),
    });
    expect(middleware).toBeDefined();
  });

  test("should execute middleware and extend context", async () => {
    const testMiddleware = new Middleware({
      handler: async (_c) => ({ testData: "hello" }),
    });

    const api = new Api();
    api.defineRoute({
      path: "/test",
      method: "GET",
      middlewares: [testMiddleware] as const,
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: async (c) => {
        const testData = c.get("testData");
        return c.json(200, { message: testData });
      },
    });

    const { baseUrl } = createTestServer(api);

    const response = await fetch(`${baseUrl}/test`);
    const data = await fetchJson<{ message: string }>(`${baseUrl}/test`);

    expect(response.status).toBe(200);
    expect(data.message).toBe("hello");
  });

  test("should allow middleware to return early with 401", async () => {
    const authMiddleware = new Middleware({
      request: {
        headers: z.object({
          authorization: z.string(),
        }),
      },
      response: {
        401: z.object({ error: z.string() }),
      },
      handler: async (c) => {
        const token = c.request.headers.authorization;

        if (!token || token !== "Bearer valid-token") {
          return c.json(401, { error: "Unauthorized" });
        }

        return { user: { id: 1, name: "Test User" } };
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/protected",
      method: "GET",
      middlewares: [authMiddleware] as const,
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: async (c) => {
        const user = c.get("user");
        return c.json(200, { message: `Hello ${user.name}` });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Test without auth header
    const res1 = await fetch(`${baseUrl}/protected`);
    expect(res1.status).toBe(400); // Missing required header

    // Test with invalid token
    const res2 = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: "Bearer invalid-token" },
    });
    const data2 = await fetchJson<{ error: string }>(`${baseUrl}/protected`, {
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(res2.status).toBe(401);
    expect(data2.error).toBe("Unauthorized");

    // Test with valid token
    const res3 = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: "Bearer valid-token" },
    });
    const data3 = await fetchJson<{ message: string }>(`${baseUrl}/protected`, {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res3.status).toBe(200);
    expect(data3.message).toBe("Hello Test User");
  });

  test("should execute multiple middlewares in sequence", async () => {
    const middleware1 = new Middleware({
      handler: async (_c) => ({ value1: "first" }),
    });

    const middleware2 = new Middleware({
      handler: async (_c) => ({ value2: "second" }),
    });

    const api = new Api();
    api.defineRoute({
      path: "/multi",
      method: "GET",
      middlewares: [middleware1, middleware2] as const,
      response: {
        200: z.object({ v1: z.string(), v2: z.string() }),
      },
      handler: async (c) => {
        const value1 = c.get("value1");
        const value2 = c.get("value2");
        return c.json(200, { v1: value1, v2: value2 });
      },
    });

    const { baseUrl } = createTestServer(api);

    const response = await fetch(`${baseUrl}/multi`);
    const data = await fetchJson<{ v1: string; v2: string }>(
      `${baseUrl}/multi`,
    );

    expect(response.status).toBe(200);
    expect(data.v1).toBe("first");
    expect(data.v2).toBe("second");
  });

  test("should support global middlewares via api.use()", async () => {
    const loggingMiddleware = new Middleware({
      handler: async (_c) => {
        return { logged: true };
      },
    });

    const api = new Api();
    api.use(loggingMiddleware);

    api.defineRoute({
      path: "/test1",
      method: "GET",
      response: {
        200: z.object({ logged: z.boolean() }),
      },
      handler: async (c) => {
        // @ts-expect-error - Global middleware context not inferred
        const logged = c.get("logged") as boolean;
        return c.json(200, { logged });
      },
    });

    api.defineRoute({
      path: "/test2",
      method: "GET",
      response: {
        200: z.object({ logged: z.boolean() }),
      },
      handler: async (c) => {
        // @ts-expect-error - Global middleware context not inferred
        const logged = c.get("logged") as boolean;
        return c.json(200, { logged });
      },
    });

    const { baseUrl } = createTestServer(api);

    const res1 = await fetchJson<{ logged: boolean }>(`${baseUrl}/test1`);
    const res2 = await fetchJson<{ logged: boolean }>(`${baseUrl}/test2`);

    expect(res1.logged).toBe(true);
    expect(res2.logged).toBe(true);
  });

  test("should combine global and route-specific middlewares", async () => {
    const globalMiddleware = new Middleware({
      handler: async (_c) => ({ global: "global-data" }),
    });

    const routeMiddleware = new Middleware({
      handler: async (_c) => ({ route: "route-data" }),
    });

    const api = new Api();
    api.use(globalMiddleware);

    api.defineRoute({
      path: "/combined",
      method: "GET",
      middlewares: [routeMiddleware] as const,
      response: {
        200: z.object({ global: z.string(), route: z.string() }),
      },
      handler: async (c) => {
        // @ts-expect-error - Global middleware context not inferred
        const global = c.get("global") as string;
        const route = c.get("route");
        return c.json(200, { global, route });
      },
    });

    const { baseUrl } = createTestServer(api);

    const data = await fetchJson<{ global: string; route: string }>(
      `${baseUrl}/combined`,
    );

    expect(data.global).toBe("global-data");
    expect(data.route).toBe("route-data");
  });

  test("should merge middleware and route schemas", async () => {
    const authMiddleware = new Middleware({
      request: {
        headers: z.object({
          authorization: z.string(),
        }),
      },
      response: {
        401: z.object({ error: z.string() }),
      },
      handler: async (c) => {
        const token = c.request.headers.authorization;
        if (!token) {
          return c.json(401, { error: "Unauthorized" });
        }
        return { user: { id: 1 } };
      },
    });

    const api = new Api({
      openapi: {
        title: "Test API",
        version: "1.0.0",
      },
    });

    api.defineRoute({
      path: "/users/{id}",
      method: "GET",
      middlewares: [authMiddleware] as const,
      request: {
        params: z.object({
          id: z.string(),
        }),
      },
      response: {
        200: z.object({ userId: z.string() }),
      },
      handler: async (c) => {
        return c.json(200, { userId: c.request.params.id });
      },
    });

    const spec = await api.getOpenApiSpec();
    const operation = spec.paths["/users/{id}"]?.get as Record<string, unknown>;

    expect(operation).toBeDefined();

    // Should have both param and header in parameters
    const parameters = operation.parameters as Array<Record<string, unknown>>;
    expect(parameters).toBeDefined();
    expect(parameters.length).toBeGreaterThanOrEqual(2);

    const hasParam = parameters.some((p) => p.in === "path" && p.name === "id");
    const hasHeader = parameters.some(
      (p) => p.in === "header" && p.name === "authorization",
    );

    expect(hasParam).toBe(true);
    expect(hasHeader).toBe(true);

    // Should have both 200 and 401 responses
    const responses = operation.responses as Record<string, unknown>;
    expect(responses["200"]).toBeDefined();
    expect(responses["401"]).toBeDefined();
  });

  test("should support parameterized middlewares via factory pattern", async () => {
    const createAuthMiddleware = (options: { requiredRole: string }) => {
      return new Middleware({
        request: {
          headers: z.object({
            authorization: z.string(),
          }),
        },
        response: {
          401: z.object({ error: z.string() }),
          403: z.object({ error: z.string() }),
        },
        handler: async (c) => {
          const token = c.request.headers.authorization;

          if (!token) {
            return c.json(401, { error: "Unauthorized" });
          }

          // Mock user role check
          const userRole = token === "Bearer admin-token" ? "admin" : "user";

          if (userRole !== options.requiredRole) {
            return c.json(403, { error: "Forbidden" });
          }

          return { user: { role: userRole } };
        },
      });
    };

    const adminMiddleware = createAuthMiddleware({ requiredRole: "admin" });

    const api = new Api();
    api.defineRoute({
      path: "/admin",
      method: "GET",
      middlewares: [adminMiddleware] as const,
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: async (c) => {
        const user = c.get("user");
        return c.json(200, { message: `Welcome ${user.role}` });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Test with user token
    const res1 = await fetch(`${baseUrl}/admin`, {
      headers: { authorization: "Bearer user-token" },
    });
    expect(res1.status).toBe(403);

    // Test with admin token
    const res2 = await fetch(`${baseUrl}/admin`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const data2 = await fetchJson<{ message: string }>(`${baseUrl}/admin`, {
      headers: { authorization: "Bearer admin-token" },
    });
    expect(res2.status).toBe(200);
    expect(data2.message).toBe("Welcome admin");
  });

  test("should handle middleware errors gracefully", async () => {
    const errorMiddleware = new Middleware({
      handler: async (_c) => {
        throw new Error("Middleware failed");
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/error",
      method: "GET",
      middlewares: [errorMiddleware] as const,
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: async (c) => {
        return c.json(200, { message: "Should not reach here" });
      },
    });

    const { baseUrl } = createTestServer(api);

    const response = await fetch(`${baseUrl}/error`);
    expect(response.status).toBe(500);

    const data = await fetchJson<{ message: string }>(`${baseUrl}/error`);
    expect(data.message).toBe("Internal server error");
  });

  test("should stop middleware execution on early return", async () => {
    let middleware2Executed = false;

    const middleware1 = new Middleware({
      response: {
        403: z.object({ error: z.string() }),
      },
      handler: async (c) => {
        return c.json(403, { error: "Forbidden" });
      },
    });

    const middleware2 = new Middleware({
      handler: async (_c) => {
        middleware2Executed = true;
        return { data: "test" };
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/early-return",
      method: "GET",
      middlewares: [middleware1, middleware2],
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: async (c) => {
        return c.json(200, { message: "Should not reach here" });
      },
    });

    const { baseUrl } = createTestServer(api);

    const response = await fetch(`${baseUrl}/early-return`);
    const data = await fetchJson<{ error: string }>(`${baseUrl}/early-return`);

    expect(response.status).toBe(403);
    expect(data.error).toBe("Forbidden");
    expect(middleware2Executed).toBe(false);
  });

  test("should work with routes without middlewares (backward compatibility)", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/no-middleware",
      method: "GET",
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: async (c) => {
        return c.json(200, { message: "Works without middleware" });
      },
    });

    const { baseUrl } = createTestServer(api);

    const response = await fetch(`${baseUrl}/no-middleware`);
    const data = await fetchJson<{ message: string }>(
      `${baseUrl}/no-middleware`,
    );

    expect(response.status).toBe(200);
    expect(data.message).toBe("Works without middleware");
  });

  test("should validate request using merged middleware schemas", async () => {
    const headerMiddleware = new Middleware({
      request: {
        headers: z.object({
          "x-custom-header": z.string(),
        }),
      },
      handler: async (_c) => {
        return { hasHeader: true };
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/validate",
      method: "GET",
      middlewares: [headerMiddleware] as const,
      response: {
        200: z.object({ success: z.boolean() }),
      },
      handler: async (c) => {
        const hasHeader = c.get("hasHeader");
        return c.json(200, { success: hasHeader });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Without required header
    const res1 = await fetch(`${baseUrl}/validate`);
    expect(res1.status).toBe(400);

    // With required header
    const res2 = await fetch(`${baseUrl}/validate`, {
      headers: { "x-custom-header": "value" },
    });
    expect(res2.status).toBe(200);
  });
});

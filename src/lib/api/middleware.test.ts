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

  test("should validate per-middleware and execute handlers in order", async () => {
    let simpleExecuted = false;
    let complexExecuted = false;

    const simple = new Middleware({
      handler: () => {
        simpleExecuted = true;
        return { simple: true };
      },
    });

    const complex = new Middleware({
      request: {
        headers: z.object({
          authorization: z.string().startsWith("Bearer "),
        }),
      },
      handler: (c) => {
        complexExecuted = true;
        return { token: c.request.headers.authorization };
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/per-middleware",
      method: "GET",
      middlewares: [simple, complex] as const,
      response: {
        200: z.object({ status: z.string() }),
      },
      handler: (c) => {
        return c.json(200, { status: "ok" });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Without Authorization header - simple should execute, complex should fail validation
    simpleExecuted = false;
    complexExecuted = false;

    const res1 = await fetch(`${baseUrl}/per-middleware`);
    expect(res1.status).toBe(400);
    expect(simpleExecuted).toBe(true); // First middleware executed
    expect(complexExecuted).toBe(false); // Second middleware validation failed

    // With Authorization header - both should execute
    simpleExecuted = false;
    complexExecuted = false;

    const res2 = await fetch(`${baseUrl}/per-middleware`, {
      headers: { authorization: "Bearer my-token" },
    });
    expect(res2.status).toBe(200);
    expect(simpleExecuted).toBe(true); // First middleware executed
    expect(complexExecuted).toBe(true); // Second middleware executed
  });

  test("should validate each middleware schema independently before handler execution", async () => {
    const executionLog: string[] = [];

    const middleware1 = new Middleware({
      handler: () => {
        executionLog.push("middleware1");
        return {};
      },
    });

    const middleware2 = new Middleware({
      request: {
        headers: z.object({
          "x-api-key": z.string(),
        }),
      },
      handler: () => {
        executionLog.push("middleware2");
        return {};
      },
    });

    const middleware3 = new Middleware({
      handler: () => {
        executionLog.push("middleware3");
        return {};
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/independent-validation",
      method: "GET",
      middlewares: [middleware1, middleware2, middleware3] as const,
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: (c) => {
        executionLog.push("handler");
        return c.json(200, { message: "ok" });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Without x-api-key header
    executionLog.length = 0;
    const res1 = await fetch(`${baseUrl}/independent-validation`);
    expect(res1.status).toBe(400);
    expect(executionLog).toEqual(["middleware1"]); // Only first middleware executed

    // With x-api-key header
    executionLog.length = 0;
    const res2 = await fetch(`${baseUrl}/independent-validation`, {
      headers: { "x-api-key": "secret" },
    });
    expect(res2.status).toBe(200);
    expect(executionLog).toEqual([
      "middleware1",
      "middleware2",
      "middleware3",
      "handler",
    ]); // All executed
  });

  test("should validate multiple request fields per middleware", async () => {
    let middleware1Executed = false;
    let middleware2Executed = false;

    const middleware1 = new Middleware({
      request: {
        headers: z.object({
          "x-tenant-id": z.string(),
        }),
      },
      handler: () => {
        middleware1Executed = true;
        return { tenant: "acme" };
      },
    });

    const middleware2 = new Middleware({
      request: {
        headers: z.object({
          authorization: z.string(),
        }),
        query: z.object({
          version: z.string(),
        }),
      },
      handler: () => {
        middleware2Executed = true;
        return { authenticated: true };
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/multi-field",
      method: "GET",
      middlewares: [middleware1, middleware2] as const,
      response: {
        200: z.object({ success: z.boolean() }),
      },
      handler: (c) => {
        return c.json(200, { success: true });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Missing x-tenant-id
    middleware1Executed = false;
    middleware2Executed = false;
    const res1 = await fetch(`${baseUrl}/multi-field`);
    expect(res1.status).toBe(400);
    expect(middleware1Executed).toBe(false);
    expect(middleware2Executed).toBe(false);

    // Has x-tenant-id but missing authorization and version
    middleware1Executed = false;
    middleware2Executed = false;
    const res2 = await fetch(`${baseUrl}/multi-field`, {
      headers: { "x-tenant-id": "123" },
    });
    expect(res2.status).toBe(400);
    expect(middleware1Executed).toBe(true); // First middleware executed
    expect(middleware2Executed).toBe(false); // Second middleware validation failed

    // Has all required fields
    middleware1Executed = false;
    middleware2Executed = false;
    const res3 = await fetch(`${baseUrl}/multi-field?version=v1`, {
      headers: {
        "x-tenant-id": "123",
        authorization: "Bearer token",
      },
    });
    expect(res3.status).toBe(200);
    expect(middleware1Executed).toBe(true);
    expect(middleware2Executed).toBe(true);
  });

  test("should allow middleware to return error response after validation passes", async () => {
    let validationPassed = false;

    const authMiddleware = new Middleware({
      request: {
        headers: z.object({
          authorization: z.string(),
        }),
      },
      response: {
        403: z.object({ error: z.string() }),
      },
      handler: (c) => {
        validationPassed = true; // Schema validation passed
        const token = c.request.headers.authorization;

        // Business logic validation
        if (token !== "Bearer valid-token") {
          return c.json(403, { error: "Invalid token" });
        }

        return { authenticated: true };
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/business-validation",
      method: "GET",
      middlewares: [authMiddleware] as const,
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: (c) => {
        return c.json(200, { message: "Success" });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Schema validation fails (no header)
    validationPassed = false;
    const res1 = await fetch(`${baseUrl}/business-validation`);
    expect(res1.status).toBe(400);
    expect(validationPassed).toBe(false);

    // Schema validation passes, business logic fails
    validationPassed = false;
    const res2 = await fetch(`${baseUrl}/business-validation`, {
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(res2.status).toBe(403);
    expect(validationPassed).toBe(true);

    // Both validations pass
    validationPassed = false;
    const res3 = await fetch(`${baseUrl}/business-validation`, {
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res3.status).toBe(200);
    expect(validationPassed).toBe(true);
  });

  test("should validate body schema per middleware", async () => {
    let middleware1Executed = false;
    let middleware2Executed = false;

    const middleware1 = new Middleware({
      handler: () => {
        middleware1Executed = true;
        return {};
      },
    });

    const middleware2 = new Middleware({
      request: {
        body: z.object({
          email: z.string().email(),
        }),
      },
      handler: () => {
        middleware2Executed = true;
        return {};
      },
    });

    const api = new Api();
    api.defineRoute({
      path: "/body-validation",
      method: "POST",
      middlewares: [middleware1, middleware2] as const,
      response: {
        200: z.object({ success: z.boolean() }),
      },
      handler: (c) => {
        return c.json(200, { success: true });
      },
    });

    const { baseUrl } = createTestServer(api);

    // Invalid email
    middleware1Executed = false;
    middleware2Executed = false;
    const res1 = await fetch(`${baseUrl}/body-validation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "invalid" }),
    });
    expect(res1.status).toBe(400);
    expect(middleware1Executed).toBe(true); // First middleware executed
    expect(middleware2Executed).toBe(false); // Second middleware validation failed

    // Valid email
    middleware1Executed = false;
    middleware2Executed = false;
    const res2 = await fetch(`${baseUrl}/body-validation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    expect(res2.status).toBe(200);
    expect(middleware1Executed).toBe(true);
    expect(middleware2Executed).toBe(true);
  });
});

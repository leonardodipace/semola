import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { z } from "zod";
import { Api } from "./index.js";

let testServer: Server<unknown> | null = null;
let currentPort = 3000;

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

describe("Api", () => {
  test("should create api instance with default options", () => {
    const api = new Api();
    expect(api).toBeDefined();
  });

  test("should create api instance with custom options", () => {
    const api = new Api({
      prefix: "/v1",
      openapi: {
        title: "Test API",
        description: "A test API",
        version: "1.0.0",
      },
    });
    expect(api).toBeDefined();
  });

  test("should define a simple GET route", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/hello",
      method: "GET",
      response: {
        200: z.object({
          message: z.string(),
        }),
      },
      handler: async (c) => {
        return c.json(200, { message: "Hello, world" });
      },
    });

    const { baseUrl } = createTestServer(api);

    const response = await fetch(`${baseUrl}/hello`);
    const data = await fetchJson<{ message: string }>(`${baseUrl}/hello`);

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: "Hello, world" });
  });

  test("should validate request body", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/users",
      method: "POST",
      request: {
        body: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      },
      response: {
        200: z.object({
          id: z.number(),
          name: z.string(),
          email: z.string(),
        }),
      },
      handler: async (c) => {
        return c.json(200, {
          id: 1,
          name: c.request.body.name,
          email: c.request.body.email,
        });
      },
    });

    const server = api.listen(3002);

    const validResponse = await fetch("http://localhost:3002/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "John", email: "john@example.com" }),
    });
    const validData = await validResponse.json();

    expect(validResponse.status).toBe(200);
    expect(validData).toEqual({
      id: 1,
      name: "John",
      email: "john@example.com",
    });

    const invalidResponse = await fetch("http://localhost:3002/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "John", email: "invalid-email" }),
    });

    expect(invalidResponse.status).toBe(400);

    server.stop();
  });

  test("should validate path parameters", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/users/{id}",
      method: "GET",
      request: {
        params: z.object({
          id: z.string().uuid(),
        }),
      },
      response: {
        200: z.object({
          id: z.string(),
          name: z.string(),
        }),
      },
      handler: async (c) => {
        return c.json(200, {
          id: c.request.params.id,
          name: "Test User",
        });
      },
    });

    const server = api.listen(3003);

    const validId = "550e8400-e29b-41d4-a716-446655440000";
    const response = await fetch(`http://localhost:3003/users/${validId}`);
    const data = await fetchJson<{ id: string; name: string }>(
      `http://localhost:3003/users/${validId}`,
    );

    expect(response.status).toBe(200);
    expect(data.id).toBe(validId);

    server.stop();
  });

  test("should handle multiple path parameters", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/users/{userId}/posts/{postId}",
      method: "GET",
      request: {
        params: z.object({
          userId: z.string(),
          postId: z.string(),
        }),
      },
      response: {
        200: z.object({
          userId: z.string(),
          postId: z.string(),
        }),
      },
      handler: async (c) => {
        return c.json(200, {
          userId: c.request.params.userId,
          postId: c.request.params.postId,
        });
      },
    });

    const server = api.listen(3004);

    const response = await fetch("http://localhost:3004/users/123/posts/456");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ userId: "123", postId: "456" });

    server.stop();
  });

  test("should validate query parameters", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/search",
      method: "GET",
      request: {
        query: z.object({
          q: z.string(),
          limit: z.string().transform((val) => Number.parseInt(val, 10)),
        }),
      },
      response: {
        200: z.object({
          query: z.string(),
          limit: z.number(),
        }),
      },
      handler: async (c) => {
        return c.json(200, {
          query: String(c.request.query.q),
          limit: Number(c.request.query.limit),
        });
      },
    });

    const server = api.listen(3005);

    const response = await fetch(
      "http://localhost:3005/search?q=test&limit=10",
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ query: "test", limit: 10 });

    server.stop();
  });

  test("should use route prefix", async () => {
    const api = new Api({ prefix: "/api/v1" });

    api.defineRoute({
      path: "/users",
      method: "GET",
      response: {
        200: z.object({
          users: z.array(z.string()),
        }),
      },
      handler: async (c) => {
        return c.json(200, { users: ["user1", "user2"] });
      },
    });

    const server = api.listen(3006);

    const response = await fetch("http://localhost:3006/api/v1/users");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ users: ["user1", "user2"] });

    server.stop();
  });

  test("should generate OpenAPI spec", async () => {
    const api = new Api({
      openapi: {
        title: "Test API",
        description: "API for testing",
        version: "1.0.0",
      },
    });

    api.defineRoute({
      path: "/users",
      method: "POST",
      summary: "Create user",
      description: "Create a new user",
      operationId: "createUser",
      tags: ["users", "admin"],
      request: {
        body: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      },
      response: {
        200: z.object({
          id: z.number(),
          name: z.string(),
          email: z.string(),
        }),
      },
      handler: async (c) => {
        return c.json(200, {
          id: 1,
          name: c.request.body.name,
          email: c.request.body.email,
        });
      },
    });

    const spec = await api.getOpenApiSpec();

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("Test API");
    expect(spec.info.version).toBe("1.0.0");
    expect(spec.paths["/users"]).toBeDefined();
    expect(spec.paths["/users"]?.post).toBeDefined();

    const postOperation = (spec.paths["/users"]?.post ?? {}) as Record<
      string,
      unknown
    >;
    expect(postOperation.operationId).toBe("createUser");
    expect(postOperation.tags).toEqual(["users", "admin"]);
    expect(postOperation.summary).toBe("Create user");
  });

  test("should handle text responses", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/text",
      method: "GET",
      response: {
        200: z.string(),
      },
      handler: async (c) => {
        return c.text(200, "Plain text response");
      },
    });

    const server = api.listen(3007);

    const response = await fetch("http://localhost:3007/text");
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe("Plain text response");

    server.stop();
  });

  test("should handle html responses", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/html",
      method: "GET",
      response: {
        200: z.string(),
      },
      handler: async (c) => {
        return c.html(200, "<h1>Hello</h1>");
      },
    });

    const server = api.listen(3008);

    const response = await fetch("http://localhost:3008/html");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toBe("<h1>Hello</h1>");
    expect(response.headers.get("content-type")).toContain("text/html");

    server.stop();
  });

  test("should handle redirects", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/redirect",
      method: "GET",
      response: {
        302: z.string(),
      },
      handler: async (c) => {
        return c.redirect(302, "/target");
      },
    });

    const server = api.listen(3009);

    const response = await fetch("http://localhost:3009/redirect", {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/target");

    server.stop();
  });

  test("should return 500 on handler error", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/error",
      method: "GET",
      response: {
        200: z.object({ message: z.string() }),
      },
      handler: async (_c) => {
        throw new Error("Handler failed");
      },
    });

    const server = api.listen(3010);

    const response = await fetch("http://localhost:3010/error");
    const data = await fetchJson<{ message: string }>(
      "http://localhost:3010/error",
    );

    expect(response.status).toBe(500);
    expect(data.message).toBe("Internal server error");

    server.stop();
  });

  test("should support multiple HTTP methods on same path", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/resource",
      method: "GET",
      response: {
        200: z.object({ method: z.string() }),
      },
      handler: async (c) => {
        return c.json(200, { method: "GET" });
      },
    });

    api.defineRoute({
      path: "/resource",
      method: "POST",
      response: {
        200: z.object({ method: z.string() }),
      },
      handler: async (c) => {
        return c.json(200, { method: "POST" });
      },
    });

    const server = api.listen(3011);

    await fetch("http://localhost:3011/resource");
    const getData = await fetchJson<{ method: string }>(
      "http://localhost:3011/resource",
    );

    await fetch("http://localhost:3011/resource", {
      method: "POST",
    });
    const postData = await fetchJson<{ method: string }>(
      "http://localhost:3011/resource",
      {
        method: "POST",
      },
    );

    expect(getData.method).toBe("GET");
    expect(postData.method).toBe("POST");

    server.stop();
  });

  test("should validate headers", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/protected",
      method: "GET",
      request: {
        headers: z.object({
          authorization: z.string(),
        }),
      },
      response: {
        200: z.object({ authorized: z.boolean() }),
      },
      handler: async (c) => {
        return c.json(200, { authorized: true });
      },
    });

    const server = api.listen(3012);

    const validResponse = await fetch("http://localhost:3012/protected", {
      headers: { authorization: "Bearer token123" },
    });

    expect(validResponse.status).toBe(200);

    const invalidResponse = await fetch("http://localhost:3012/protected");

    expect(invalidResponse.status).toBe(400);

    server.stop();
  });

  test("should validate cookies", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/session",
      method: "GET",
      request: {
        cookies: z.object({
          sessionId: z.string(),
        }),
      },
      response: {
        200: z.object({ sessionId: z.string() }),
      },
      handler: async (c) => {
        return c.json(200, { sessionId: c.request.cookies.sessionId });
      },
    });

    const server = api.listen(3013);

    const response = await fetch("http://localhost:3013/session", {
      headers: { cookie: "sessionId=abc123" },
    });
    const data = await fetchJson<{ sessionId: string }>(
      "http://localhost:3013/session",
      {
        headers: { cookie: "sessionId=abc123" },
      },
    );

    expect(response.status).toBe(200);
    expect(data.sessionId).toBe("abc123");

    server.stop();
  });

  test("should validate response data", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/invalid-response",
      method: "GET",
      response: {
        200: z.object({
          id: z.string().uuid(),
          name: z.string(),
        }),
      },
      handler: async (c) => {
        return c.json(200, {
          id: "invalid-uuid",
          name: "Test",
        });
      },
    });

    const server = api.listen(3014);

    const response = await fetch("http://localhost:3014/invalid-response");
    const data = await fetchJson<{ message: string }>(
      "http://localhost:3014/invalid-response",
    );

    expect(response.status).toBe(500);
    expect(data.message).toBe("Invalid response data");

    server.stop();
  });

  test("should allow valid response data", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/valid-response",
      method: "GET",
      response: {
        200: z.object({
          id: z.string().uuid(),
          name: z.string(),
        }),
      },
      handler: async (c) => {
        return c.json(200, {
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Test",
        });
      },
    });

    const server = api.listen(3015);

    const response = await fetch("http://localhost:3015/valid-response");
    const data = await fetchJson<{ id: string; name: string }>(
      "http://localhost:3015/valid-response",
    );

    expect(response.status).toBe(200);
    expect(data.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(data.name).toBe("Test");

    server.stop();
  });
});

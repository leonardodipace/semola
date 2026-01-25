import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { generateOpenApiSpec } from "./openapi.js";
import type { InternalRoute } from "./types.js";

describe("generateOpenApiSpec", () => {
  test("should generate basic OpenAPI spec", async () => {
    const routes: InternalRoute[] = [];
    const spec = await generateOpenApiSpec(routes, {});

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("API");
    expect(spec.info.version).toBe("1.0.0");
    expect(spec.paths).toEqual({});
  });

  test("should use custom API info", async () => {
    const routes: InternalRoute[] = [];
    const spec = await generateOpenApiSpec(routes, {
      openapi: {
        title: "My API",
        description: "A custom API",
        version: "2.0.0",
      },
    });

    expect(spec.info.title).toBe("My API");
    expect(spec.info.description).toBe("A custom API");
    expect(spec.info.version).toBe("2.0.0");
  });

  test("should generate spec for simple GET route", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/users",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/users",
          method: "GET",
          response: {
            200: z.object({ users: z.array(z.string()) }),
          },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});

    expect(spec.paths["/users"]).toBeDefined();
    expect(spec.paths["/users"]?.get).toBeDefined();
  });

  test("should include operation metadata", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/users",
        method: "POST",
        handler: async () => new Response(),
        definition: {
          path: "/users",
          method: "POST",
          operationId: "createUser",
          summary: "Create a user",
          description: "Creates a new user in the system",
          tags: ["users", "admin"],
          response: { 200: z.object({ id: z.number() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/users"]?.post ?? {}) as Record<
      string,
      unknown
    >;

    expect(operation.operationId).toBe("createUser");
    expect(operation.summary).toBe("Create a user");
    expect(operation.description).toBe("Creates a new user in the system");
    expect(operation.tags).toEqual(["users", "admin"]);
  });

  test("should convert path parameters", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/users/:id",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/users/{id}",
          method: "GET",
          request: {
            params: z.object({ id: z.string() }),
          },
          response: { 200: z.object({ id: z.string() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});

    expect(spec.paths["/users/{id}"]).toBeDefined();
    const operation = (spec.paths["/users/{id}"]?.get ?? {}) as Record<
      string,
      unknown
    >;
    const parameters = operation.parameters as Array<{
      name: string;
      in: string;
      required: boolean;
    }>;

    expect(parameters).toHaveLength(1);
    expect(parameters[0]?.name).toBe("id");
    expect(parameters[0]?.in).toBe("path");
    expect(parameters[0]?.required).toBe(true);
  });

  test("should handle query parameters", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/search",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/search",
          method: "GET",
          request: {
            query: z.object({
              q: z.string(),
              limit: z.number().optional(),
            }),
          },
          response: { 200: z.object({ results: z.array(z.string()) }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/search"]?.get ?? {}) as Record<
      string,
      unknown
    >;
    const parameters = operation.parameters as Array<{
      name: string;
      in: string;
      required: boolean;
    }>;

    expect(parameters).toHaveLength(2);

    const qParam = parameters.find((p) => p.name === "q");
    const limitParam = parameters.find((p) => p.name === "limit");

    expect(qParam?.in).toBe("query");
    expect(qParam?.required).toBe(true);

    expect(limitParam?.in).toBe("query");
    expect(limitParam?.required).toBe(false);
  });

  test("should handle header parameters", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/protected",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/protected",
          method: "GET",
          request: {
            headers: z.object({
              authorization: z.string(),
              "x-api-key": z.string().optional(),
            }),
          },
          response: { 200: z.object({ success: z.boolean() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/protected"]?.get ?? {}) as Record<
      string,
      unknown
    >;
    const parameters = operation.parameters as Array<{
      name: string;
      in: string;
      required: boolean;
    }>;

    expect(parameters.length).toBeGreaterThanOrEqual(1);

    const authParam = parameters.find((p) => p.name === "authorization");
    expect(authParam?.in).toBe("header");
    expect(authParam?.required).toBe(true);
  });

  test("should handle cookie parameters", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/session",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/session",
          method: "GET",
          request: {
            cookies: z.object({
              sessionId: z.string(),
            }),
          },
          response: { 200: z.object({ valid: z.boolean() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/session"]?.get ?? {}) as Record<
      string,
      unknown
    >;
    const parameters = operation.parameters as Array<{
      name: string;
      in: string;
      required: boolean;
    }>;

    expect(parameters).toHaveLength(1);
    expect(parameters[0]?.name).toBe("sessionId");
    expect(parameters[0]?.in).toBe("cookie");
    expect(parameters[0]?.required).toBe(true);
  });

  test("should handle request body", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/users",
        method: "POST",
        handler: async () => new Response(),
        definition: {
          path: "/users",
          method: "POST",
          request: {
            body: z.object({
              name: z.string(),
              email: z.string().email(),
            }),
          },
          response: { 201: z.object({ id: z.number() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/users"]?.post ?? {}) as Record<
      string,
      unknown
    >;
    const requestBody = operation.requestBody as {
      required: boolean;
      content: Record<string, unknown>;
    };

    expect(requestBody.required).toBe(true);
    expect(requestBody.content["application/json"]).toBeDefined();
  });

  test("should handle multiple response status codes", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/users",
        method: "POST",
        handler: async () => new Response(),
        definition: {
          path: "/users",
          method: "POST",
          request: {
            body: z.object({ name: z.string() }),
          },
          response: {
            201: z.object({ id: z.number() }),
            400: z.object({ error: z.string() }),
            409: z.object({ error: z.string() }),
          },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/users"]?.post ?? {}) as Record<
      string,
      unknown
    >;
    const responses = operation.responses as Record<string, unknown>;

    expect(responses["201"]).toBeDefined();
    expect(responses["400"]).toBeDefined();
    expect(responses["409"]).toBeDefined();
  });

  test("should handle multiple routes on same path", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/users",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/users",
          method: "GET",
          response: { 200: z.array(z.object({ id: z.number() })) },
          handler: async () => new Response(),
        },
      },
      {
        path: "/users",
        method: "POST",
        handler: async () => new Response(),
        definition: {
          path: "/users",
          method: "POST",
          request: { body: z.object({ name: z.string() }) },
          response: { 201: z.object({ id: z.number() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});

    expect(spec.paths["/users"]?.get).toBeDefined();
    expect(spec.paths["/users"]?.post).toBeDefined();
  });

  test("should handle multiple path parameters", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/users/:userId/posts/:postId",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/users/{userId}/posts/{postId}",
          method: "GET",
          request: {
            params: z.object({
              userId: z.string(),
              postId: z.string(),
            }),
          },
          response: { 200: z.object({ id: z.string() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/users/{userId}/posts/{postId}"]?.get ??
      {}) as Record<string, unknown>;
    const parameters = operation.parameters as Array<{
      name: string;
      in: string;
    }>;

    expect(parameters).toHaveLength(2);
    expect(parameters.some((p) => p.name === "userId")).toBe(true);
    expect(parameters.some((p) => p.name === "postId")).toBe(true);
  });

  test("should handle route without request schema", async () => {
    const routes: InternalRoute[] = [
      {
        path: "/health",
        method: "GET",
        handler: async () => new Response(),
        definition: {
          path: "/health",
          method: "GET",
          response: { 200: z.object({ status: z.string() }) },
          handler: async () => new Response(),
        },
      },
    ];

    const spec = await generateOpenApiSpec(routes, {});
    const operation = (spec.paths["/health"]?.get ?? {}) as Record<
      string,
      unknown
    >;

    expect(operation.parameters).toEqual([]);
    expect(operation.requestBody).toBeUndefined();
  });
});

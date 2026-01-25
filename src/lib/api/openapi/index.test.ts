import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Middleware } from "../middleware/index.js";
import { generateOpenApiSpec } from "./index.js";

describe("OpenAPI Generation", () => {
  test("should generate a valid base spec with info", async () => {
    const spec = await generateOpenApiSpec({
      title: "Test API",
      version: "1.2.3",
      description: "A simple description",
      routes: [],
    });

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Test API");
    expect(spec.info.version).toBe("1.2.3");
    expect(spec.info.description).toBe("A simple description");
  });

  test("should convert routes with request and response schemas", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/users",
          method: "POST",
          request: {
            body: z.object({ name: z.string() }),
            query: z.object({ age: z.string().optional() }),
          },
          response: {
            201: z.object({ id: z.string() }),
          },
          handler: () => {},
          summary: "Create User",
        },
      ],
    });

    const route = spec.paths["/users"]?.post;
    expect(route?.summary).toBe("Create User");

    // Check parameters (query)
    expect(route?.parameters).toContainEqual(
      expect.objectContaining({ name: "age", in: "query" }),
    );

    // Check request body
    expect(
      route?.requestBody?.content["application/json"]?.schema,
    ).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });

    // Check responses
    expect(
      route?.responses["201"]?.content?.["application/json"]?.schema,
    ).toMatchObject({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });

  test("should handle path parameters correctly", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/users/:userId",
          method: "GET",
          request: {
            params: z.object({ userId: z.string() }),
          },
          handler: () => {},
        },
      ],
    });

    // Normalized path from :param to {param}
    expect(spec.paths["/users/{userId}"]).toBeDefined();

    const operation = spec.paths["/users/{userId}"]?.get;
    expect(operation?.parameters).toContainEqual(
      expect.objectContaining({ name: "userId", in: "path", required: true }),
    );
  });

  test("should merge schemas from middlewares", async () => {
    const authMw = new Middleware({
      request: { headers: z.object({ authorization: z.string() }) },
      handler: () => ({}),
    });

    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      globalMiddlewares: [authMw],
      routes: [
        {
          path: "/me",
          method: "GET",
          handler: () => {},
        },
      ],
    });

    const parameters = spec.paths["/me"]?.get?.parameters;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "authorization", in: "header" }),
    );
  });

  test("should include security schemes if provided", async () => {
    const securitySchemes = {
      bearerAuth: {
        type: "http" as const,
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    };

    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      securitySchemes,
      routes: [],
    });

    expect(spec.components?.securitySchemes).toEqual(securitySchemes);
  });

  test("should apply URL prefixing to paths", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      prefix: "/v1",
      routes: [
        {
          path: "/health",
          method: "GET",
          handler: () => {},
        },
      ],
    });

    expect(spec.paths["/v1/health"]).toBeDefined();
  });
});

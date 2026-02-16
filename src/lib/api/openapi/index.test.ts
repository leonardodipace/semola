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

    // Check request body - should now be a $ref
    const requestBodySchema =
      route?.requestBody?.content["application/json"]?.schema;
    expect(requestBodySchema).toHaveProperty("$ref");
    expect(typeof requestBodySchema?.$ref).toBe("string");

    // Verify the schema exists in components
    const requestSchemaRef = requestBodySchema?.$ref as string;
    const requestSchemaName = requestSchemaRef?.split("/").pop();
    expect(spec.components?.schemas?.[requestSchemaName]).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });

    // Check responses - should now be a $ref
    const responseSchema =
      route?.responses["201"]?.content?.["application/json"]?.schema;
    expect(responseSchema).toHaveProperty("$ref");
    expect(typeof responseSchema?.$ref).toBe("string");

    // Verify the schema exists in components
    const responseSchemaRef = responseSchema?.$ref as string;
    const responseSchemaName = responseSchemaRef?.split("/").pop();
    expect(spec.components?.schemas?.[responseSchemaName]).toMatchObject({
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

  test("should handle all HTTP methods", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        { path: "/resource", method: "GET", handler: () => {} },
        { path: "/resource", method: "POST", handler: () => {} },
        { path: "/resource", method: "PUT", handler: () => {} },
        { path: "/resource", method: "PATCH", handler: () => {} },
        { path: "/resource", method: "DELETE", handler: () => {} },
      ],
    });

    const resourcePath = spec.paths["/resource"];
    expect(resourcePath?.get).toBeDefined();
    expect(resourcePath?.post).toBeDefined();
    expect(resourcePath?.put).toBeDefined();
    expect(resourcePath?.patch).toBeDefined();
    expect(resourcePath?.delete).toBeDefined();
  });

  test("should handle headers and cookies as parameters", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/session",
          method: "POST",
          request: {
            headers: z.object({ "x-api-key": z.string() }),
            cookies: z.object({ sessionId: z.string() }),
            body: z.object({ data: z.string() }),
          },
          handler: () => {},
        },
      ],
    });

    const parameters = spec.paths["/session"]?.post?.parameters;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "x-api-key", in: "header" }),
    );
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "sessionId", in: "cookie" }),
    );
  });

  test("should handle multiple path parameters", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/users/:userId/posts/:postId",
          method: "GET",
          request: {
            params: z.object({ userId: z.string(), postId: z.string() }),
          },
          handler: () => {},
        },
      ],
    });

    expect(spec.paths["/users/{userId}/posts/{postId}"]).toBeDefined();

    const parameters =
      spec.paths["/users/{userId}/posts/{postId}"]?.get?.parameters;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "userId", in: "path", required: true }),
    );
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "postId", in: "path", required: true }),
    );
  });

  test("should handle route-level middlewares", async () => {
    const validationMw = new Middleware({
      request: { body: z.object({ validated: z.boolean() }) },
      handler: () => ({}),
    });

    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/data",
          method: "POST",
          middlewares: [validationMw],
          handler: () => {},
        },
      ],
    });

    const requestBody = spec.paths["/data"]?.post?.requestBody;
    const requestBodySchema = requestBody?.content["application/json"]?.schema;

    // Check that schema is now a $ref
    expect(requestBodySchema).toHaveProperty("$ref");
    expect(typeof requestBodySchema?.$ref).toBe("string");

    // Verify the schema exists in components
    const schemaRef = requestBodySchema?.$ref as string;
    const schemaName = schemaRef?.split("/").pop();
    expect(spec.components?.schemas?.[schemaName]).toMatchObject({
      type: "object",
      properties: { validated: { type: "boolean" } },
    });
  });

  test("should include operation metadata", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/items",
          method: "GET",
          summary: "List Items",
          description: "Returns a list of all items",
          operationId: "listItems",
          tags: ["items", "public"],
          handler: () => {},
        },
      ],
    });

    const operation = spec.paths["/items"]?.get;
    expect(operation?.summary).toBe("List Items");
    expect(operation?.description).toBe("Returns a list of all items");
    expect(operation?.operationId).toBe("listItems");
    expect(operation?.tags).toEqual(["items", "public"]);
  });

  test("should include servers configuration", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      servers: [
        { url: "https://api.example.com", description: "Production" },
        { url: "https://staging-api.example.com", description: "Staging" },
      ],
      routes: [],
    });

    expect(spec.servers).toHaveLength(2);
    expect(spec.servers?.[0]).toEqual({
      url: "https://api.example.com",
      description: "Production",
    });
  });

  test("should handle multiple response status codes", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/resource",
          method: "GET",
          response: {
            200: z.object({ data: z.string() }),
            404: z.object({ error: z.string() }),
            500: z.object({ message: z.string() }),
          },
          handler: () => {},
        },
      ],
    });

    const responses = spec.paths["/resource"]?.get?.responses;
    expect(responses?.["200"]).toBeDefined();
    expect(responses?.["404"]).toBeDefined();
    expect(responses?.["500"]).toBeDefined();
  });

  test("should mark required parameters correctly", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/search",
          method: "GET",
          request: {
            query: z.object({
              q: z.string(),
              limit: z.number().optional(),
            }),
          },
          handler: () => {},
        },
      ],
    });

    const parameters = spec.paths["/search"]?.get?.parameters;
    const qParam = parameters?.find((p) => p.name === "q");
    const limitParam = parameters?.find((p) => p.name === "limit");

    expect(qParam?.required).toBe(true);
    expect(limitParam?.required).toBe(false);
  });

  test("should handle same path with different methods", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [
        {
          path: "/users/:id",
          method: "GET",
          request: { params: z.object({ id: z.string() }) },
          handler: () => {},
        },
        {
          path: "/users/:id",
          method: "PUT",
          request: {
            params: z.object({ id: z.string() }),
            body: z.object({ name: z.string() }),
          },
          handler: () => {},
        },
        {
          path: "/users/:id",
          method: "DELETE",
          request: { params: z.object({ id: z.string() }) },
          handler: () => {},
        },
      ],
    });

    const userPath = spec.paths["/users/{id}"];
    expect(userPath?.get).toBeDefined();
    expect(userPath?.put).toBeDefined();
    expect(userPath?.delete).toBeDefined();
  });

  test("should handle empty routes array", async () => {
    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      routes: [],
    });

    expect(spec.paths).toEqual({});
    expect(spec.info.title).toBe("API");
  });

  test("should merge multiple global middlewares", async () => {
    const authMw = new Middleware({
      request: { headers: z.object({ authorization: z.string() }) },
      handler: () => ({}),
    });

    const queryMw = new Middleware({
      request: { query: z.object({ page: z.string() }) },
      handler: () => ({}),
    });

    const spec = await generateOpenApiSpec({
      title: "API",
      version: "1.0.0",
      globalMiddlewares: [authMw, queryMw],
      routes: [
        {
          path: "/protected",
          method: "GET",
          handler: () => {},
        },
      ],
    });

    const parameters = spec.paths["/protected"]?.get?.parameters;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "authorization", in: "header" }),
    );
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "page", in: "query" }),
    );
  });

  test("should reuse schemas in components instead of inlining", async () => {
    // Create a schema that will be reused
    const UserSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
    });

    const spec = await generateOpenApiSpec({
      title: "Test API",
      version: "1.0.0",
      routes: [
        {
          path: "/users",
          method: "POST",
          request: { body: UserSchema },
          response: { 201: UserSchema },
          handler: () => {},
        },
        {
          path: "/users/:id",
          method: "GET",
          request: { params: z.object({ id: z.string() }) },
          response: { 200: UserSchema },
          handler: () => {},
        },
        {
          path: "/users/:id",
          method: "PUT",
          request: {
            params: z.object({ id: z.string() }),
            body: UserSchema,
          },
          response: { 200: UserSchema },
          handler: () => {},
        },
      ],
    });

    // All schemas should be references
    const postRequest =
      spec.paths["/users"]?.post?.requestBody?.content["application/json"]
        ?.schema;
    const postResponse =
      spec.paths["/users"]?.post?.responses["201"]?.content?.[
        "application/json"
      ]?.schema;
    const getResponse =
      spec.paths["/users/{id}"]?.get?.responses["200"]?.content?.[
        "application/json"
      ]?.schema;
    const putRequest =
      spec.paths["/users/{id}"]?.put?.requestBody?.content["application/json"]
        ?.schema;
    const putResponse =
      spec.paths["/users/{id}"]?.put?.responses["200"]?.content?.[
        "application/json"
      ]?.schema;

    // All should have $ref
    expect(postRequest).toHaveProperty("$ref");
    expect(postResponse).toHaveProperty("$ref");
    expect(getResponse).toHaveProperty("$ref");
    expect(putRequest).toHaveProperty("$ref");
    expect(putResponse).toHaveProperty("$ref");

    // Response schemas should all reference the same schema (with additionalProperties: false)
    expect(postResponse.$ref).toBe(getResponse.$ref);
    expect(getResponse.$ref).toBe(putResponse.$ref);

    // Request schemas should reference the same schema (without additionalProperties: false)
    expect(postRequest.$ref).toBe(putRequest.$ref);

    // But request and response schemas should be different (due to additionalProperties difference)
    expect(postRequest.$ref).not.toBe(postResponse.$ref);

    // Verify only 2 unique schemas are created in components (1 for requests, 1 for responses)
    const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
    expect(schemaCount).toBe(2);

    // Verify both schemas have the expected properties
    for (const schemaName in spec.components?.schemas) {
      const schema = spec.components.schemas[schemaName];
      expect(schema).toMatchObject({
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
        },
        required: ["id", "name", "email"],
      });
    }
  });
});

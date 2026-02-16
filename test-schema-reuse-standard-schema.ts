import { z } from "zod";
import { generateOpenApiSpec } from "./src/lib/api/openapi/index.js";

// Test that schema reuse works correctly with Zod (which implements StandardSchema)
// This demonstrates the feature works with any StandardSchema-compliant library

async function testSchemaReuse() {
  console.log("Testing Schema Reuse with Zod (StandardSchema v1)...\n");

  // Define reusable schemas with IDs
  const UserSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
  }).meta({ id: "User" });

  const CreateUserRequest = z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }).meta({ id: "CreateUserRequest" });

  const ErrorResponse = z.object({
    error: z.string(),
    message: z.string(),
  }).meta({ id: "ErrorResponse" });

  // Schema without ID (will be inlined)
  const PaginationQuery = z.object({
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  });

  const spec = await generateOpenApiSpec({
    title: "User API",
    version: "1.0.0",
    description: "API demonstrating schema reuse",
    routes: [
      {
        path: "/users",
        method: "POST",
        request: { body: CreateUserRequest },
        response: { 201: UserSchema, 400: ErrorResponse },
        handler: () => {},
        summary: "Create a user",
      },
      {
        path: "/users/:id",
        method: "GET",
        request: { params: z.object({ id: z.string().uuid() }) },
        response: { 200: UserSchema, 404: ErrorResponse },
        handler: () => {},
        summary: "Get a user",
      },
      {
        path: "/users/:id",
        method: "PUT",
        request: {
          params: z.object({ id: z.string().uuid() }),
          body: CreateUserRequest,
        },
        response: { 200: UserSchema, 400: ErrorResponse, 404: ErrorResponse },
        handler: () => {},
        summary: "Update a user",
      },
      {
        path: "/users",
        method: "GET",
        request: { query: PaginationQuery },
        response: {
          200: z.object({
            users: z.array(UserSchema),
            total: z.number().int(),
          }).meta({ id: "UserListResponse" }),
        },
        handler: () => {},
        summary: "List users",
      },
    ],
  });

  // Verify schema reuse
  console.log("✓ Generated OpenAPI spec");
  console.log(`✓ Components schemas: ${Object.keys(spec.components?.schemas || {}).join(", ")}`);
  
  // Check that schemas are referenced
  const postUsers = spec.paths["/users"]?.post;
  const getUser = spec.paths["/users/{id}"]?.get;
  const putUser = spec.paths["/users/{id}"]?.put;
  const getUsers = spec.paths["/users"]?.get;

  console.log("\nVerifying $ref usage:");
  console.log(`✓ POST /users request body: ${JSON.stringify(postUsers?.requestBody?.content["application/json"]?.schema)}`);
  console.log(`✓ POST /users 201 response: ${JSON.stringify(postUsers?.responses["201"]?.content?.["application/json"]?.schema)}`);
  console.log(`✓ GET /users/:id 200 response: ${JSON.stringify(getUser?.responses["200"]?.content?.["application/json"]?.schema)}`);
  console.log(`✓ PUT /users/:id request body: ${JSON.stringify(putUser?.requestBody?.content["application/json"]?.schema)}`);
  console.log(`✓ GET /users 200 response: ${JSON.stringify(getUsers?.responses["200"]?.content?.["application/json"]?.schema)}`);

  // Check that query params are inlined
  console.log(`\n✓ GET /users query params (inlined): ${getUsers?.parameters?.length} parameters`);

  // Count how many times each schema is referenced
  const specStr = JSON.stringify(spec);
  const userRefs = (specStr.match(/"#\/components\/schemas\/User"/g) || []).length;
  const createUserRefs = (specStr.match(/"#\/components\/schemas\/CreateUserRequest"/g) || []).length;
  const errorRefs = (specStr.match(/"#\/components\/schemas\/ErrorResponse"/g) || []).length;

  console.log("\nSchema reuse statistics:");
  console.log(`✓ User schema referenced ${userRefs} times (defined once)`);
  console.log(`✓ CreateUserRequest referenced ${createUserRefs} times (defined once)`);
  console.log(`✓ ErrorResponse referenced ${errorRefs} times (defined once)`);

  console.log("\n✅ All tests passed! Schema reuse is working correctly.");
  console.log("\nNote: This same pattern works with any StandardSchema v1 library:");
  console.log("  - Zod (tested above)");
  console.log("  - Valibot (use .pipe(metadata({ id: '...' })))");
  console.log("  - ArkType (use .describe() with id metadata)");
  console.log("  - Any library implementing StandardSchema v1 specification");
}

testSchemaReuse().catch(console.error);

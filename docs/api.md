# API Framework

A lightweight, type-safe REST API framework built on Bun's native routing with automatic validation and OpenAPI spec generation.

## Import

```typescript
import { Api } from "semola/api";
```

## API

### `new Api(options?)`

Creates a new API instance with optional configuration.

```typescript
const api = new Api({
  prefix: "/api/v1",
  openapi: {
    title: "My API",
    description: "A type-safe REST API",
    version: "1.0.0",
  },
});
```

### `api.defineRoute(definition)`

Defines a route with type-safe request/response validation using Standard Schema-compatible libraries (Zod, Valibot, ArkType, etc.).

```typescript
import { z } from "zod";

api.defineRoute({
  path: "/users/{id}",
  method: "GET",
  summary: "Get user by ID",
  operationId: "getUserById",
  tags: ["Users"],
  request: {
    params: z.object({
      id: z.uuid(),
    }),
  },
  response: {
    200: z.object({
      id: z.string(),
      name: z.string(),
      email: z.email(),
    }),
    404: z.object({
      message: z.string(),
    }),
  },
  handler: async (ctx) => {
    // ctx.request.params.id is typed as string (validated UUID)
    const user = await getUser(ctx.request.params.id);
    
    if (!user) {
      return ctx.json(404, { message: "User not found" });
    }
    
    // Response is validated against schema before being sent
    return ctx.json(200, user);
  },
});
```

### `api.getOpenApiSpec()`

Generates an OpenAPI 3.0.3 specification from defined routes.

```typescript
const spec = await api.getOpenApiSpec();
// Returns OpenAPI spec object ready for Swagger UI, Redoc, etc.
```

### `api.listen(port, callback?)`

Starts the server on the specified port.

```typescript
api.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

### `api.close()`

Stops the server.

```typescript
api.close();
```

## Handler Context

The handler receives a context object with type-safe request data and response methods:

### Request Data
- `ctx.request.body` - Validated request body
- `ctx.request.params` - Validated path parameters
- `ctx.request.query` - Validated query parameters
- `ctx.request.headers` - Validated headers
- `ctx.request.cookies` - Validated cookies
- `ctx.raw` - Underlying Request object

### Response Methods
- `ctx.json(status, data)` - JSON response with validation
- `ctx.text(status, text)` - Plain text response
- `ctx.html(status, html)` - HTML response
- `ctx.redirect(status, url)` - HTTP redirect

## Features

- **Full type safety**: Request/response types inferred from schemas
- **Standard Schema support**: Works with Zod, Valibot, ArkType, and other Standard Schema libraries
- **Automatic validation**: Request validation (400 on error), response validation (500 on error)
- **OpenAPI generation**: Automatic OpenAPI 3.0.3 spec from route definitions
- **Bun-native routing**: Leverages Bun.serve's SIMD-accelerated routing
- **Result pattern**: Uses `[error, data]` tuples internally for error handling

## Usage Example

```typescript
import { z } from "zod";
import { Api } from "semola/api";

// Define schemas
const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
});

const ErrorSchema = z.object({
  message: z.string(),
});

// Create API
const api = new Api({
  prefix: "/api/v1",
  openapi: {
    title: "User API",
    description: "Manage users",
    version: "1.0.0",
  },
});

// Define routes
api.defineRoute({
  path: "/users",
  method: "POST",
  summary: "Create a new user",
  tags: ["Users"],
  request: {
    body: CreateUserSchema,
  },
  response: {
    201: UserSchema,
    400: ErrorSchema,
  },
  handler: async (ctx) => {
    // ctx.request.body is typed as { name: string; email: string }
    const user = await createUser(ctx.request.body);
    
    return ctx.json(201, user);
  },
});

api.defineRoute({
  path: "/users/{id}",
  method: "GET",
  summary: "Get user by ID",
  tags: ["Users"],
  request: {
    params: z.object({
      id: z.uuid(),
    }),
  },
  response: {
    200: UserSchema,
    404: ErrorSchema,
  },
  handler: async (ctx) => {
    const user = await findUser(ctx.request.params.id);
    
    if (!user) {
      return ctx.json(404, { message: "User not found" });
    }
    
    return ctx.json(200, user);
  },
});

api.defineRoute({
  path: "/users",
  method: "GET",
  summary: "List users with pagination",
  tags: ["Users"],
  request: {
    query: z.object({
      page: z.string().transform((val) => parseInt(val, 10)).optional(),
      limit: z.string().transform((val) => parseInt(val, 10)).optional(),
    }),
  },
  response: {
    200: z.object({
      users: z.array(UserSchema),
      total: z.number(),
    }),
  },
  handler: async (ctx) => {
    const page = ctx.request.query.page ?? 1;
    const limit = ctx.request.query.limit ?? 10;
    
    const { users, total } = await listUsers(page, limit);
    
    return ctx.json(200, { users, total });
  },
});

// Generate OpenAPI spec (optional)
const spec = await api.getOpenApiSpec();
console.log(JSON.stringify(spec, null, 2));

// Start server
api.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

## Request Validation

All request fields are validated before reaching your handler:

- **Body**: JSON request body (validates Content-Type)
- **Params**: Path parameters (e.g., `/users/{id}`)
- **Query**: Query string (supports arrays like `?tags=a&tags=b`)
- **Headers**: HTTP headers
- **Cookies**: Parsed from Cookie header

Invalid requests receive **400 Bad Request** with detailed error messages.

## Response Validation

All responses are validated before being sent. This prevents accidentally sending malformed data that doesn't match your API contract.

Invalid responses trigger **500 Internal Server Error**, signaling a server-side bug that needs fixing.

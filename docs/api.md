# API Framework

A lightweight, type-safe REST API framework built on Bun's native routing with automatic validation and OpenAPI spec generation.

## Requirements

**Bun Runtime Required:** This API framework is built specifically for the Bun runtime and uses Bun-native APIs including `Bun.serve()`, `Bun.CookieMap`, and optimized routing. You must have Bun installed to use this framework.

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

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
  path: "/users/:id",
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
  handler: async (c) => {
    // c.req.params.id is typed as string (validated UUID)
    const user = await getUser(c.req.params.id);

    if (!user) {
      return c.json(404, { message: "User not found" });
    }

    return c.json(200, user);
  },
});
```

### `api.getOpenApiSpec()`

Generates an OpenAPI 3.1.0 specification from defined routes.

```typescript
const spec = await api.getOpenApiSpec();
// Returns OpenAPI spec object ready for Swagger UI, Redoc, etc.
```

#### OpenAPI 3.1.0 Benefits

This framework generates OpenAPI 3.1.0 specifications, which provide several advantages over 3.0:

- **Full JSON Schema Compatibility**: Uses standard JSON Schema Draft 2020-12, removing the need for OpenAPI-specific schema extensions
- **Better Null Handling**: Uses standard JSON Schema type unions instead of the custom `nullable` keyword
- **Modern Features**: Support for tuple validation, conditional schemas (if/then/else), and `$ref` with sibling keywords
- **Improved Type Safety**: More precise `exclusiveMinimum`/`exclusiveMaximum` as numbers rather than booleans

The generated spec is compatible with modern OpenAPI tooling including Swagger UI, Redoc, and OpenAPI Generator.

### `api.serve(port, callback?)`

Starts the server on the specified port.

```typescript
api.serve(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

## Handler Context

The handler receives a context object with type-safe request data and response methods:

### Request Data

- `c.req.body` - Validated request body
- `c.req.params` - Validated path parameters
- `c.req.query` - Validated query parameters
- `c.req.headers` - Validated headers
- `c.req.cookies` - Validated cookies
- `c.raw` - Underlying Request object

### Response Methods

- `c.json(status, data)` - JSON response with validation
- `c.text(status, text)` - Plain text response
- `c.html(status, html)` - HTML response
- `c.redirect(status, url)` - HTTP redirect

## Features

- **Full type safety**: Request/response types inferred from schemas
- **Standard Schema support**: Works with Zod, Valibot, ArkType, and other Standard Schema libraries
- **Automatic validation**: Request validation (400 on error)
- **OpenAPI generation**: Automatic OpenAPI 3.1.0 spec from route definitions
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
  handler: async (c) => {
    // c.req.body is typed as { name: string; email: string }
    const user = await createUser(c.req.body);

    return c.json(201, user);
  },
});

api.defineRoute({
  path: "/users/:id",
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
  handler: async (c) => {
    const user = await findUser(c.req.params.id);

    if (!user) {
      return c.json(404, { message: "User not found" });
    }

    return c.json(200, user);
  },
});

api.defineRoute({
  path: "/users",
  method: "GET",
  summary: "List users with pagination",
  tags: ["Users"],
  request: {
    query: z.object({
      page: z
        .string()
        .transform((val) => parseInt(val, 10))
        .optional(),
      limit: z
        .string()
        .transform((val) => parseInt(val, 10))
        .optional(),
    }),
  },
  response: {
    200: z.object({
      users: z.array(UserSchema),
      total: z.number(),
    }),
  },
  handler: async (c) => {
    const page = c.req.query.page ?? 1;
    const limit = c.req.query.limit ?? 10;

    const { users, total } = await listUsers(page, limit);

    return c.json(200, { users, total });
  },
});

// Generate OpenAPI spec (optional)
const spec = await api.getOpenApiSpec();
console.log(JSON.stringify(spec, null, 2));

// Start server
api.serve(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

## Request Validation

All request fields are validated before reaching your handler:

- **Body**: JSON request body (validates Content-Type)
- **Params**: Path parameters (e.g., `/users/:id`)
- **Query**: Query string (supports arrays like `?tags=a&tags=b`)
- **Headers**: HTTP headers
- **Cookies**: Parsed from Cookie header

Invalid requests receive **400 Bad Request** with detailed error messages.

## Middlewares

Middlewares allow you to run code before your route handler executes. They're perfect for authentication, logging, rate limiting, and extending the request context with shared data.

### Defining a Middleware

```typescript
import { Middleware } from "semola/api";
import { z } from "zod";

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
    const token = c.req.headers.authorization;

    if (!token || !token.startsWith("Bearer ")) {
      return c.json(401, { error: "Unauthorized" });
    }

    const user = await validateToken(token.slice(7));

    if (!user) {
      return c.json(401, { error: "Invalid token" });
    }

    // Return data to extend the context
    return { user };
  },
});
```

### Using Middlewares

#### Route-Specific Middlewares

Apply middlewares to individual routes:

```typescript
api.defineRoute({
  path: "/profile",
  method: "GET",
  middlewares: [authMiddleware] as const,
  response: {
    200: z.object({
      id: z.string(),
      name: z.string(),
    }),
  },
  handler: async (c) => {
    // Access middleware data via c.get()
    const user = c.get("user");

    return c.json(200, {
      id: user.id,
      name: user.name,
    });
  },
});
```

#### Global Middlewares

Apply middlewares to all routes by passing them to the API constructor:

```typescript
// Logging middleware
const loggingMiddleware = new Middleware({
  handler: async (c) => {
    const start = Date.now();
    console.log(`${c.raw.method} ${c.raw.url}`);

    return {
      requestStartTime: start,
    };
  },
});

// Apply globally via constructor
const api = new Api({
  middlewares: [loggingMiddleware] as const,
});

// Now all routes will have logging
api.defineRoute({
  path: "/users",
  method: "GET",
  response: {
    200: z.array(UserSchema),
  },
  handler: async (c) => {
    const startTime = c.get("requestStartTime");
    const users = await getUsers();

    console.log(`Request took ${Date.now() - startTime}ms`);
    return c.json(200, users);
  },
});
```

### Middleware Behavior

#### Early Return

Middlewares can return a `Response` to short-circuit the request:

```typescript
const rateLimitMiddleware = new Middleware({
  response: {
    429: z.object({ error: z.string() }),
  },
  handler: async (c) => {
    const ip = c.raw.headers.get("x-forwarded-for");

    if (await isRateLimited(ip)) {
      // Return Response - handler won't execute
      return c.json(429, { error: "Too many requests" });
    }

    // Return data - continue to next middleware/handler
    return { ip };
  },
});
```

#### Multiple Middlewares

Middlewares execute in order, accumulating context data:

```typescript
const requestIdMiddleware = new Middleware({
  handler: async () => ({
    requestId: crypto.randomUUID(),
  }),
});

const authMiddleware = new Middleware({
  handler: async () => ({
    user: { id: "123", role: "admin" },
  }),
});

api.defineRoute({
  path: "/admin",
  method: "POST",
  middlewares: [requestIdMiddleware, authMiddleware] as const,
  response: {
    200: z.object({ message: z.string() }),
  },
  handler: async (c) => {
    // Access data from both middlewares
    const requestId = c.get("requestId");
    const user = c.get("user");

    console.log(`Request ${requestId} by user ${user.id}`);
    return c.json(200, { message: "Success" });
  },
});
```

### Combining Global and Route Middlewares

Global middlewares run first, then route-specific middlewares:

```typescript
// Global: runs on all routes (defined in constructor)
const api = new Api({
  middlewares: [loggingMiddleware] as const,
});

// Route-specific: runs only on this route (after logging)
api.defineRoute({
  path: "/admin",
  method: "GET",
  middlewares: [authMiddleware, adminRoleMiddleware] as const,
  response: {
    200: z.object({ data: z.string() }),
  },
  handler: async (c) => {
    // Has access to data from all three middlewares
    const startTime = c.get("requestStartTime");
    const user = c.get("user");

    return c.json(200, { data: "Admin data" });
  },
});
```

### Middleware Schemas

Middlewares can define request and response schemas that are validated independently.

**Schema Validation Behavior:**

- Each middleware validates its request data against its own schema before executing
- Route validates its request data against its own schema after all middlewares complete
- All schemas must pass validation—there is no merging or replacement, each validates independently
- Different properties (body vs. query vs. headers) from different middlewares and routes are all validated

```typescript
const apiKeyMiddleware = new Middleware({
  request: {
    headers: z.object({
      "x-api-key": z.string(),
    }),
  },
  response: {
    403: z.object({ error: z.string() }),
  },
  handler: async (c) => {
    const apiKey = c.req.headers["x-api-key"];

    if (!isValidApiKey(apiKey)) {
      return c.json(403, { error: "Invalid API key" });
    }

    return { apiKeyValid: true };
  },
});

// Route with additional headers
api.defineRoute({
  path: "/data",
  method: "GET",
  middlewares: [apiKeyMiddleware] as const,
  request: {
    headers: z.object({
      "accept-language": z.string().optional(),
    }),
  },
  response: {
    200: z.object({ data: z.array(z.string()) }),
  },
  handler: async (c) => {
    // Both x-api-key (from middleware) and accept-language (from route) are validated
    const lang = c.req.headers["accept-language"];

    return c.json(200, { data: ["item1", "item2"] });
  },
});
```

### Parameterized Middlewares

Create reusable middleware factories:

```typescript
const createRoleMiddleware = (requiredRole: string) => {
  return new Middleware({
    response: {
      403: z.object({ error: z.string() }),
    },
    handler: async (c) => {
      const user = c.get("user"); // From authMiddleware

      if (user.role !== requiredRole) {
        return c.json(403, { error: "Forbidden" });
      }

      return {};
    },
  });
};

// Use different roles for different routes
api.defineRoute({
  path: "/admin",
  method: "GET",
  middlewares: [authMiddleware, createRoleMiddleware("admin")] as const,
  response: {
    200: z.object({ message: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, { message: "Admin area" });
  },
});

api.defineRoute({
  path: "/moderator",
  method: "GET",
  middlewares: [authMiddleware, createRoleMiddleware("moderator")] as const,
  response: {
    200: z.object({ message: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, { message: "Moderator area" });
  },
});
```

### Common Middleware Patterns

#### CORS Middleware

```typescript
const corsMiddleware = new Middleware({
  handler: async (c) => {
    // CORS would typically be handled at response time,
    // but you can add headers here if needed
    return { corsEnabled: true };
  },
});
```

#### Database Transaction Middleware

```typescript
const transactionMiddleware = new Middleware({
  handler: async (c) => {
    const tx = await db.beginTransaction();

    return { transaction: tx };
  },
});

api.defineRoute({
  path: "/transfer",
  method: "POST",
  middlewares: [transactionMiddleware] as const,
  request: {
    body: z.object({
      from: z.string(),
      to: z.string(),
      amount: z.number(),
    }),
  },
  response: {
    200: z.object({ success: z.boolean() }),
  },
  handler: async (c) => {
    const tx = c.get("transaction");

    try {
      await debit(tx, c.req.body.from, c.req.body.amount);
      await credit(tx, c.req.body.to, c.req.body.amount);
      await tx.commit();

      return c.json(200, { success: true });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
});
```

#### Request Context Middleware

```typescript
const contextMiddleware = new Middleware({
  handler: async (c) => {
    return {
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      ip: c.raw.headers.get("x-forwarded-for") || "unknown",
      userAgent: c.raw.headers.get("user-agent") || "unknown",
    };
  },
});
```

### Type Safety

Middleware data is fully typed. TypeScript infers the types from the data you return:

```typescript
const typedMiddleware = new Middleware({
  handler: async (c) => {
    return {
      userId: "123",
      isAdmin: true,
      permissions: ["read", "write"],
    };
  },
});

api.defineRoute({
  path: "/test",
  method: "GET",
  middlewares: [typedMiddleware] as const,
  response: {
    200: z.object({ ok: z.boolean() }),
  },
  handler: async (c) => {
    // TypeScript infers these types automatically:
    const userId = c.get("userId"); // string
    const isAdmin = c.get("isAdmin"); // boolean
    const permissions = c.get("permissions"); // string[]

    return c.json(200, { ok: true });
  },
});
```

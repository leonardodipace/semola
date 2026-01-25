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
  handler: async (c) => {
    // c.request.params.id is typed as string (validated UUID)
    const user = await getUser(c.request.params.id);
    
    if (!user) {
      return c.json(404, { message: "User not found" });
    }
    
    // Response is validated against schema before being sent
    return c.json(200, user);
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
- `c.request.body` - Validated request body
- `c.request.params` - Validated path parameters
- `c.request.query` - Validated query parameters
- `c.request.headers` - Validated headers
- `c.request.cookies` - Validated cookies
- `c.raw` - Underlying Request object

### Response Methods
- `c.json(status, data)` - JSON response with validation
- `c.text(status, text)` - Plain text response
- `c.html(status, html)` - HTML response
- `c.redirect(status, url)` - HTTP redirect

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
  handler: async (c) => {
    // c.request.body is typed as { name: string; email: string }
    const user = await createUser(c.request.body);
    
    return c.json(201, user);
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
  handler: async (c) => {
    const user = await findUser(c.request.params.id);
    
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
  handler: async (c) => {
    const page = c.request.query.page ?? 1;
    const limit = c.request.query.limit ?? 10;
    
    const { users, total } = await listUsers(page, limit);
    
    return c.json(200, { users, total });
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
    const token = c.request.headers.authorization;
    
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

Apply middlewares to all routes:

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

// Apply globally
api.use(loggingMiddleware);

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
// Global: runs on all routes
api.use(loggingMiddleware);

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

Middlewares can define request and response schemas that merge with route schemas:

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
    const apiKey = c.request.headers["x-api-key"];
    
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
    const lang = c.request.headers["accept-language"];
    
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
      await debit(tx, c.request.body.from, c.request.body.amount);
      await credit(tx, c.request.body.to, c.request.body.amount);
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
    const userId = c.get("userId");       // string
    const isAdmin = c.get("isAdmin");     // boolean
    const permissions = c.get("permissions"); // string[]
    
    return c.json(200, { ok: true });
  },
});
```

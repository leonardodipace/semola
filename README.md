# semola

A TypeScript utility kit providing type-safe error handling, caching, internationalization, policy-based authorization, and developer tools.

## Installation

```bash
npm install semola
```

```bash
bun add semola
```

## Features

### Policy

A type-safe policy-based authorization system for defining and enforcing access control rules with conditional logic.

#### Import

```typescript
import { Policy } from "semola/policy";
```

#### API

**`new Policy()`**

Creates a new policy instance for managing authorization rules.

```typescript
const policy = new Policy();
```

**`policy.allow<T>(params: AllowParams<T>)`**

Defines a rule that grants permission for an action on an entity, optionally with conditions and a reason.

```typescript
type Post = {
  id: number;
  title: string;
  authorId: number;
  status: string;
};

// Allow reading all published posts
policy.allow<Post>({
  action: "read",
  entity: "Post",
  reason: "Public posts are visible to everyone",
  conditions: {
    status: "published"
  }
});

// Allow all read access without conditions
policy.allow({
  action: "read",
  entity: "Comment",
  reason: "Comments are public"
});
```

**`policy.forbid<T>(params: ForbidParams<T>)`**

Defines a rule that denies permission for an action on an entity, optionally with conditions and a reason.

```typescript
// Forbid updating published posts
policy.forbid<Post>({
  action: "update",
  entity: "Post",
  reason: "Published posts cannot be modified",
  conditions: {
    status: "published"
  }
});

// Forbid deleting admin users
policy.forbid({
  action: "delete",
  entity: "User",
  reason: "You cannot delete admins"
});
```

**`policy.can<T>(action: Action, entity: Entity, object?: T): CanResult`**

Checks if an action is permitted on an entity, optionally validating against an object's conditions. Returns a result object with `allowed` (boolean) and optional `reason` (string).

```typescript
const post: Post = {
  id: 1,
  title: "My Post",
  authorId: 1,
  status: "published"
};

policy.can<Post>("read", "Post", post);
// { allowed: true, reason: "Public posts are visible to everyone" }

policy.can<Post>("update", "Post", post);
// { allowed: false, reason: "Published posts cannot be modified" }

policy.can("delete", "Post");
// { allowed: false, reason: undefined }
```

#### Types

```typescript
type Action = "read" | "create" | "update" | "delete" | (string & {});
type Entity = string;
type Conditions<T> = Partial<T>;

type CanResult = {
  allowed: boolean;
  reason?: string;
};
```

#### Features

- **Type-safe conditions**: Conditions are validated against the object type
- **Flexible actions**: Built-in CRUD actions plus custom string actions
- **Multiple conditions**: Rules can match multiple object properties
- **Allow/Forbid semantics**: Explicit permission and denial rules
- **Human-readable reasons**: Optional explanations for authorization decisions
- **No match defaults to deny**: Conservative security model
- **Zero dependencies**: Pure TypeScript implementation

#### Usage Example

```typescript
import { Policy } from "semola/policy";

type Post = {
  id: number;
  title: string;
  authorId: number;
  status: string;
};

// Create policy
const policy = new Policy();

// Define rules with reasons
policy.allow<Post>({
  action: "read",
  entity: "Post",
  reason: "Published posts are publicly accessible",
  conditions: {
    status: "published"
  }
});

policy.allow<Post>({
  action: "update",
  entity: "Post",
  reason: "Draft posts can be edited",
  conditions: {
    status: "draft"
  }
});

policy.forbid<Post>({
  action: "delete",
  entity: "Post",
  reason: "Published posts cannot be deleted",
  conditions: {
    status: "published"
  }
});

// Check permissions
const publishedPost: Post = {
  id: 1,
  title: "Hello World",
  authorId: 1,
  status: "published"
};

const draftPost: Post = {
  id: 2,
  title: "Work in Progress",
  authorId: 1,
  status: "draft"
};

// Check permissions with reasons
const readResult = policy.can<Post>("read", "Post", publishedPost);
console.log(readResult);
// { allowed: true, reason: "Published posts are publicly accessible" }

const updateDraftResult = policy.can<Post>("update", "Post", draftPost);
console.log(updateDraftResult);
// { allowed: true, reason: "Draft posts can be edited" }

const deleteResult = policy.can<Post>("delete", "Post", publishedPost);
console.log(deleteResult);
// { allowed: false, reason: "Published posts cannot be deleted" }

// Use in authorization middleware
function authorize<T>(action: Action, entity: Entity, object?: T) {
  const result = policy.can(action, entity, object);
  if (!result.allowed) {
    throw new Error(result.reason || "Unauthorized");
  }
}

// Protect routes with meaningful error messages
authorize<Post>("delete", "Post", publishedPost);
// throws Error: "Published posts cannot be deleted"

authorize<Post>("read", "Post", publishedPost);
// passes
```

### API Framework

A lightweight, type-safe REST API framework built on Bun's native routing with automatic validation and OpenAPI spec generation.

#### Import

```typescript
import { Api } from "semola/api";
```

#### API

**`new Api(options?)`**

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

**`api.defineRoute(definition)`**

Defines a route with type-safe request/response validation using Standard Schema-compatible libraries (Zod, Valibot, ArkType, etc.).

```typescript
import { z } from "zod";

api.defineRoute({
  path: "/users/{id}",
  method: "GET",
  summary: "Get user by ID",
  operationId: "getUserById",
  tags: ["users"],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  response: {
    200: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
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

**`api.getOpenApiSpec()`**

Generates an OpenAPI 3.0.3 specification from defined routes.

```typescript
const spec = await api.getOpenApiSpec();
// Returns OpenAPI spec object ready for Swagger UI, Redoc, etc.
```

**`api.listen(port, callback?)`**

Starts the server on the specified port.

```typescript
api.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

**`api.close()`**

Stops the server.

```typescript
api.close();
```

#### Handler Context

The handler receives a context object with type-safe request data and response methods:

**Request Data**
- `ctx.request.body` - Validated request body
- `ctx.request.params` - Validated path parameters
- `ctx.request.query` - Validated query parameters
- `ctx.request.headers` - Validated headers
- `ctx.request.cookies` - Validated cookies
- `ctx.raw` - Underlying Request object

**Response Methods**
- `ctx.json(status, data)` - JSON response with validation
- `ctx.text(status, text)` - Plain text response
- `ctx.html(status, html)` - HTML response
- `ctx.redirect(status, url)` - HTTP redirect

#### Features

- **Full type safety**: Request/response types inferred from schemas
- **Standard Schema support**: Works with Zod, Valibot, ArkType, and other Standard Schema libraries
- **Automatic validation**: Request validation (400 on error), response validation (500 on error)
- **OpenAPI generation**: Automatic OpenAPI 3.0.3 spec from route definitions
- **Bun-native routing**: Leverages Bun.serve's SIMD-accelerated routing
- **Minimal overhead**: ~580 lines of clean implementation code
- **Result pattern**: Uses `[error, data]` tuples internally for error handling

#### Usage Example

```typescript
import { z } from "zod";
import { Api } from "semola/api";

// Define schemas
const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
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
  tags: ["users"],
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
  tags: ["users"],
  request: {
    params: z.object({
      id: z.string().uuid(),
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
  tags: ["users"],
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

#### Request Validation

All request fields are validated before reaching your handler:

- **Body**: JSON request body (validates Content-Type)
- **Params**: Path parameters (e.g., `/users/{id}`)
- **Query**: Query string (supports arrays like `?tags=a&tags=b`)
- **Headers**: HTTP headers
- **Cookies**: Parsed from Cookie header

Invalid requests receive **400 Bad Request** with detailed error messages.

#### Response Validation

All responses are validated before being sent. This prevents accidentally sending malformed data that doesn't match your API contract.

Invalid responses trigger **500 Internal Server Error**, signaling a server-side bug that needs fixing.

### Internationalization (i18n)

A fully type-safe internationalization utility with compile-time validation of translation keys and parameters.

#### Import

```typescript
import { I18n } from "semola/i18n";
```

#### API

**`new I18n<TLocales, TDefaultLocale>(config)`**

Creates a new i18n instance with type-safe locale management.

```typescript
const i18n = new I18n({
  defaultLocale: "en",
  locales: {
    en: {
      common: {
        hello: "Hello, world",
        sayHi: "Hi, {name:string}",
        age: "I am {age:number} years old",
        active: "Status: {active:boolean}"
      }
    },
    es: {
      common: {
        hello: "Hola, mundo",
        sayHi: "Hola, {name:string}",
        age: "Tengo {age:number} años",
        active: "Estado: {active:boolean}"
      }
    }
  } as const // Required for type inference
});
```

**`i18n.translate(key, params?)`**

Translates a key with optional parameters. Fully type-safe - invalid keys, missing parameters, or wrong parameter types cause compile-time errors.

```typescript
// Basic translation
i18n.translate("common.hello")
// "Hello, world"

// With parameters
i18n.translate("common.sayHi", { name: "Leonardo" })
// "Hi, Leonardo"

i18n.translate("common.age", { age: 25 })
// "I am 25 years old"

// Type errors (won't compile)
i18n.translate("invalid.key")                    // ✗ Invalid key
i18n.translate("common.sayHi")                   // ✗ Missing required params
i18n.translate("common.sayHi", { name: 123 })    // ✗ Wrong param type
i18n.translate("common.hello", { name: "x" })    // ✗ Unnecessary params
```

**`i18n.setLocale(locale)`**

Switches to a different locale. Type-safe - only valid locale keys are accepted.

```typescript
i18n.setLocale("es")
i18n.translate("common.hello")
// "Hola, mundo"

i18n.setLocale("invalid") // ✗ Type error
```

**`i18n.getLocale()`**

Returns the current locale.

```typescript
const currentLocale = i18n.getLocale()
// "es"
```

#### Parameter Syntax

Translation strings support typed parameters with the syntax `{paramName:type}`:

- `{name:string}` - String parameter
- `{age:number}` - Number parameter  
- `{active:boolean}` - Boolean parameter

The type system extracts these at compile time and enforces them in the `translate()` method.

#### Features

- **Type-safe keys**: Only valid nested keys accepted (e.g., `"common.hello"`)
- **Type-safe parameters**: Parameter types validated at compile time
- **Type-safe locales**: Only defined locale keys can be set
- **Nested translations**: Support for deeply nested translation objects
- **Locale fallback**: Falls back to default locale if translation missing
- **Zero runtime overhead**: No runtime type checking - pure TypeScript validation
- **Const assertion required**: Use `as const` on locale objects for proper type inference

#### Usage Example

```typescript
import { I18n } from "semola/i18n";

const translations = {
  en: {
    auth: {
      welcome: "Welcome back, {name:string}!",
      loginSuccess: "Successfully logged in",
      loginFailed: "Login failed"
    },
    profile: {
      age: "Age: {age:number}",
      verified: "Verified: {status:boolean}"
    }
  },
  es: {
    auth: {
      welcome: "Bienvenido, {name:string}!",
      loginSuccess: "Inicio de sesión exitoso",
      loginFailed: "Inicio de sesión fallido"
    },
    profile: {
      age: "Edad: {age:number}",
      verified: "Verificado: {status:boolean}"
    }
  }
} as const;

const i18n = new I18n({
  defaultLocale: "en",
  locales: translations
});

// Use in your app
function greetUser(name: string) {
  return i18n.translate("auth.welcome", { name });
}

function showProfile(age: number, verified: boolean) {
  console.log(i18n.translate("profile.age", { age }));
  console.log(i18n.translate("profile.verified", { status: verified }));
}

// Switch language
i18n.setLocale("es");
greetUser("Maria"); // "Bienvenido, Maria!"
```

### Cache

A type-safe Redis cache wrapper with TTL support and result-based error handling. Built on Bun's native Redis client.

#### Import

```typescript
import { Cache } from "semola/cache";
```

#### API

**`new Cache<T>(options: CacheOptions)`**

Creates a new cache instance with optional TTL configuration.

```typescript
type CacheOptions = {
  redis: Bun.RedisClient;
  ttl?: number; // Time-to-live in milliseconds
};

const cache = new Cache<User>({
  redis: redisClient,
  ttl: 60000 // Optional: cache entries expire after 60 seconds
});
```

**`cache.get(key: string)`**

Retrieves a value from the cache. Returns a result tuple with the parsed value or an error.

```typescript
const [error, user] = await cache.get("user:123");

if (error) {
  switch (error.type) {
    case "NotFoundError":
      console.log("Cache miss");
      break;
    case "CacheError":
      console.error("Cache error:", error.message);
      break;
  }
} else {
  console.log("Cache hit:", user);
}
```

**`cache.set(key: string, value: T)`**

Stores a value in the cache with automatic JSON serialization. Applies TTL if configured.

```typescript
const [error, data] = await cache.set("user:123", { id: 123, name: "John" });

if (error) {
  console.error("Failed to cache:", error.message);
} else {
  console.log("Cached successfully");
}
```

**`cache.delete(key: string)`**

Removes a key from the cache.

```typescript
const [error] = await cache.delete("user:123");

if (error) {
  console.error("Failed to delete:", error.message);
}
```

#### Usage Example

```typescript
import { Cache } from "semola/cache";

type User = {
  id: number;
  name: string;
  email: string;
};

// Create cache instance
const userCache = new Cache<User>({
  redis: new Bun.RedisClient("redis://localhost:6379"),
  ttl: 300000 // 5 minutes
});

// Get or fetch user
async function getUser(id: string) {
  // Try cache first
  const [cacheError, cachedUser] = await userCache.get(`user:${id}`);
  
  if (!cacheError) {
    return ok(cachedUser);
  }

  // Cache miss - fetch from database
  const [dbError, user] = await fetchUserFromDB(id);
  
  if (dbError) {
    return err("NotFoundError", "User not found");
  }

  // Store in cache for next time
  await userCache.set(`user:${id}`, user);
  
  return ok(user);
}
```

**Note on lifecycle management:** The `Cache` class does not manage the Redis client lifecycle. Since you provide the client when creating the cache, you're responsible for closing it when done:

```typescript
const redis = new Bun.RedisClient("redis://localhost:6379");
const cache = new Cache({ redis });

// Use the cache...

// Clean up when done
await redis.quit();
```

### Error Utilities

Result-based error handling inspired by functional programming patterns. Avoid throwing exceptions and handle errors explicitly with type-safe tuples.

#### Import

```typescript
import { ok, err, mightThrow, mightThrowSync } from "semola/errors";
```

#### API

**`ok<T>(data: T)`**

Creates a successful result tuple.

```typescript
const result = ok({ userId: 123, name: "John" });
// [null, { userId: 123, name: "John" }]

const [error, data] = result;

if (error) {
  // Handle error
} else {
  console.log(data.userId); // Type-safe access
}
```

**`err<T>(type: T, message: string)`**

Creates an error result tuple with a typed error object.

```typescript
const result = err("NotFoundError", "User not found");
// [{ type: "NotFoundError", message: "User not found" }, null]

const [error, data] = result;

if (error) {
  console.log(error.type);    // "NotFoundError"
  console.log(error.message); // "User not found"
}
```

**Common error types:** `NotFoundError`, `UnauthorizedError`, `InternalServerError`, `ValidationError`, or any custom string.

**`mightThrow<T>(promise: Promise<T>)`**

Wraps async operations that might throw into result tuples.

```typescript
const [error, data] = await mightThrow(fetch('/api/users'));

if (error) {
  console.error("Request failed:", error);
  return;
}

console.log("Success:", data);
```

**`mightThrowSync<T>(fn: () => T)`**

Wraps synchronous operations that might throw into result tuples.

```typescript
const [error, data] = mightThrowSync(() => JSON.parse(input));

if (error) {
  console.error("Parse failed:", error);
  return;
}

console.log("Parsed:", data);
```

#### Usage Example

```typescript
import { ok, err, mightThrow } from "semola/errors";

async function getUser(id: string) {
  if (!id) {
    return err("ValidationError", "User ID is required");
  }

  const [fetchError, response] = await mightThrow(
    fetch(`/api/users/${id}`)
  );

  if (fetchError) {
    return err("InternalServerError", "Failed to fetch user");
  }

  const [parseError, user] = await mightThrow(response.json());

  if (parseError) {
    return err("InternalServerError", "Invalid response format");
  }

  return ok(user);
}

// Usage
const [error, user] = await getUser("123");

if (error) {
  switch (error.type) {
    case "ValidationError":
      console.log("Validation failed:", error.message);
      break;
    case "NotFoundError":
      console.log("User not found");
      break;
    default:
      console.log("Error:", error.message);
  }
} else {
  console.log("User:", user);
}
```

## Publishing

This package uses GitHub Actions to automatically publish to npm. To publish a new version:

1. Update the version in `package.json`:
   ```bash
   bun version <major|minor|patch>
   ```

2. Create a new release on GitHub:
   - Go to the [Releases page](https://github.com/leonardodipace/semola/releases)
   - Click "Create a new release"
   - Create a new tag (e.g., `v0.3.0`)
   - Publish the release

The GitHub Action will automatically:
- Run checks and tests
- Build the package
- Publish to npm with provenance

Alternatively, you can manually trigger the workflow from the Actions tab and optionally specify a version.

**Note:** This package uses npm's Trusted Publishing feature, so no NPM_TOKEN is required. The workflow authenticates using GitHub's OIDC token with the `id-token: write` permission.

## Development

```bash
# Install dependencies
bun install

# Build package
bun run build

# Build types
bun run build:types
```

## License

MIT © Leonardo Dipace

## Repository

[https://github.com/leonardodipace/semola](https://github.com/leonardodipace/semola)

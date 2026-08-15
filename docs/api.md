---
title: API
description: Typed HTTP routes, middleware, groups, and OpenAPI on Bun
---

Build HTTP APIs with validated requests and responses. Schemas use any [Standard Schema](https://standardschema.dev/) library (Zod, Valibot, ArkType, …). OpenAPI comes from the same route definitions.

Needs Bun's HTTP server (`Bun.serve` under the hood via `api.serve`).

## Import

```typescript
import { Api, Group, Middleware } from "semola/api";
```

## Quick start

This registers a validated `GET /users/:id` route, then starts Bun's HTTP server on port 3000.

```typescript
import { Api } from "semola/api";
import { z } from "zod";

const api = new Api();

api.defineRoute({
  path: "/users/:id",
  method: "GET",
  request: {
    params: z.object({ id: z.string() }),
  },
  response: {
    200: z.object({ id: z.string(), email: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, {
      id: c.req.params.id,
      email: "hi@semola.dev",
    });
  },
});

api.serve(3000);
```

For tests or embedding, call `api.fetch(request)` instead of serving.

## Request and response

All request fields are optional. Whatever you declare is validated and typed into the handler.

### Params, query, body, headers

This route validates request body, query, and headers before calling `createPost`, then checks the `201` response against its schema.

```typescript
api.defineRoute({
  path: "/posts",
  method: "POST",
  request: {
    body: z.object({ title: z.string(), body: z.string() }),
    query: z.object({ draft: z.stringbool().optional() }),
    headers: z.object({ "x-request-id": z.string().optional() }),
  },
  response: {
    201: z.object({ id: z.string() }),
    400: z.object({ error: z.string() }),
  },
  handler: async (c) => {
    const post = await createPost(c.req.body);
    return c.json(201, { id: post.id });
  },
});
```

Invalid input becomes a 400. Query and header values are always strings; use schema coercion such as Zod's `z.stringbool()` when you want a boolean (`?draft=true` → `true`). Toggle validation with `new Api({ validation: false })` or `{ validation: { input: true, output: false } }`.

### Route context

- **`c.req`** - validated `params`, `query`, `body`, `headers`, `cookies`
- **`c.raw`** - the underlying `Request`
- **`c.json` / `c.text` / `c.html` / `c.redirect`** - typed responses
- **`c.header(name, value)`** - set a header on the returned response
- **`c.get(key)`** - values contributed by middleware

You can also return a plain string or object; Semola wraps it as a response.

## Middleware

Middleware can validate, short-circuit with a `Response`, or attach typed data to the context:

Middleware runs before the route handler. Here, a missing token returns `401` without running the route; a valid token adds `userId`, which the route reads with `c.get`.

```typescript
const auth = new Middleware({
  handler: async (c) => {
    const token = c.raw.headers.get("authorization");

    if (!token) {
      return c.json(401, { error: "Unauthorized" });
    }

    return { userId: "u_123" };
  },
});

api.defineRoute({
  path: "/me",
  method: "GET",
  middlewares: [auth] as const,
  handler: async (c) => {
    return c.json(200, { userId: c.get("userId") });
  },
});
```

Pass middleware arrays as `as const` so `c.get` is typed from those extensions. Without it, `middlewares: [auth]` infers `Middleware[]` and `c.get("userId")` is `never`.

Pass middleware on the API (`new Api({ middlewares: [...] })`), a group, or a single route.
Execution order is API middleware, outer-to-inner group middleware, route middleware, then the route handler. Any middleware that returns a `Response` stops the chain.

## Groups

Share a path prefix and middleware across routes:

This creates `GET /admin/stats`. The group's authentication middleware runs before the route handler.

```typescript
const admin = new Group({
  prefix: "/admin",
  middlewares: [auth],
});

admin.defineRoute({
  path: "/stats",
  method: "GET",
  handler: (c) => c.json(200, { ok: true }),
});

api.mount(admin);
```

## SSE

Server-sent events use a generator handler (GET only):

This route streams two events in order, then closes the connection when the generator finishes.

```typescript
api.defineSSERoute({
  path: "/events",
  handler: async function* (c) {
    yield { data: "hello" };
    yield { event: "ping", data: "1" };
  },
});
```

String `data` is sent raw; other values are JSON-encoded.

## OpenAPI

Route metadata (`summary`, `description`, `operationId`, `tags`) and schemas feed the spec:

This configures document metadata and builds the OpenAPI object from all registered routes.

```typescript
const api = new Api({
  openapi: {
    title: "My API",
    version: "1.0.0",
  },
});

const spec = api.getOpenApiSpec();
```

Serve that JSON from a route if you want a public `/openapi.json`.

## Examples

### Authenticated route

The `auth` middleware runs first. It either returns `401` immediately or contributes `userId`, then the `/me` route builds the successful response.

```typescript
const auth = new Middleware({
  handler: async (c) => {
    const token = c.raw.headers.get("authorization");

    if (!token) {
      return c.json(401, { error: "Unauthorized" });
    }

    return { userId: parseToken(token) };
  },
});

api.defineRoute({
  path: "/me",
  method: "GET",
  middlewares: [auth] as const,
  response: {
    200: z.object({ userId: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, { userId: c.get("userId") });
  },
});
```

### Nested groups

Mounting `users` inside `v1`, then `v1` inside the API, combines both prefixes into `GET /v1/users/:id`.

```typescript
const v1 = new Group({ prefix: "/v1" });
const users = new Group({ prefix: "/users", middlewares: [auth] });

users.defineRoute({
  path: "/:id",
  method: "GET",
  request: {
    params: z.object({ id: z.string() }),
  },
  handler: async (c) => c.json(200, await getUser(c.req.params.id)),
});

v1.mount(users);
api.mount(v1);
// GET /v1/users/:id
```

### Fetch in tests

`fetch()` dispatches a `Request` through the same route pipeline without opening a network port.

```typescript
api.defineRoute({
  path: "/health",
  method: "GET",
  summary: "Health check",
  handler: () => ({ ok: true }),
});

const res = await api.fetch(new Request("http://localhost/health"));
expect(res.status).toBe(200);
```

### Build an OpenAPI document

`getOpenApiSpec()` collects registered route metadata and schemas into an OpenAPI document.

```typescript
const api = new Api({
  openapi: { title: "Users", version: "1.0.0" },
});

const spec = api.getOpenApiSpec();
expect(spec.info.title).toBe("Users");
```

### Disable output validation

This keeps request validation enabled while returning handler output without checking response schemas.

```typescript
const api = new Api({
  validation: { input: true, output: false },
});
```

### Response headers

Middleware sets the request ID first, then the route adds download metadata and returns the CSV body. Both headers are copied to the response.

```typescript
const requestId = new Middleware({
  handler: (c) => {
    c.header("X-Request-Id", crypto.randomUUID());
  },
});

api.defineRoute({
  path: "/download",
  method: "GET",
  middlewares: [requestId],
  handler: (c) => {
    c.header("Content-Disposition", 'attachment; filename="report.csv"');

    return c.text(200, "id,name\n1,Ada");
  },
});
```

Headers from middleware and the route are copied onto the returned `Response`.

### Get Bun route handlers

`getRouteHandlers()` compiles registered routes into the map expected by `Bun.serve`.

```typescript
const routes = api.getRouteHandlers();

const server = Bun.serve({
  routes,
  fetch: () => new Response("Not found", { status: 404 }),
});
```

### Start a server

`serve()` starts `Bun.serve` and passes the server instance to the optional callback.

```typescript
api.serve(3000, (server) => {
  console.log(`Listening on ${server.url}`);
});
```

## Reference

### `Api` options

| Option | Default | Meaning |
| --- | --- | --- |
| `prefix` | - | Path prefix for all routes |
| `openapi` | `{ title: "API", version: "1.0.0" }` | OpenAPI document info |
| `middlewares` | `[]` | Applied to every route |
| `validation` | `{ input: true, output: true }` | `false` disables both; partial object ok |

### Methods

| Method | Meaning |
| --- | --- |
| `defineRoute(config)` | Register an HTTP route |
| `defineSSERoute(config)` | Register a GET SSE route |
| `mount(group)` | Mount a `Group` |
| `fetch(request)` | Handle a request without listening |
| `getRouteHandlers()` | Build Bun's route handler map |
| `getOpenApiSpec()` | Build the OpenAPI document |
| `serve(port, callback?)` | Start `Bun.serve` |

There is no `listen` method.

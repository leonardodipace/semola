---
title: API
description: Build typed HTTP APIs on Bun, Node, Deno, and Cloudflare Workers with Semola - routes, middleware, groups, and OpenAPI
---

Build HTTP APIs with validated requests and responses. Schemas use any [Standard Schema](https://standardschema.dev/) library ([`semola/schema`](/docs/schema), Zod, Valibot, ArkType, …). OpenAPI comes from the same route definitions.

Runs on Bun, Node, Deno, and Cloudflare Workers. `api.fetch` is a web-standard handler; `api.serve` starts a server on Bun and Node.

## Import

```typescript
import { Api, ApiClient, Group, Middleware } from "semola/api";
```

## Quick start

This registers a validated `GET /users/:id` route, then starts an HTTP server on port 3000.

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
      email: "hi@semo.la",
    });
  },
});

await api.serve(3000);
```

For tests or embedding, call `api.fetch(request)` instead of serving.

## Typed client

`defineRoute` returns a handle. Nest handles into a router object, then pass that router to `ApiClient(...)` for typed calls with no codegen:

```typescript
import { Api, ApiClient } from "semola/api";
import { z } from "zod";

const api = new Api();

const getUser = api.defineRoute({
  path: "/users/:id",
  method: "GET",
  request: {
    params: z.object({ id: z.string() }),
  },
  response: {
    200: z.object({ id: z.string(), email: z.string() }),
  },
  handler: (c) =>
    c.json(200, { id: c.req.params.id, email: "hi@semo.la" }),
});

const listUsers = api.defineRoute({
  path: "/users",
  method: "GET",
  response: {
    200: z.object({ items: z.array(z.string()) }),
  },
  handler: () => ({ items: ["u_1"] }),
});

const appRouter = {
  users: {
    get: getUser,
    list: listUsers,
  },
};

const client = ApiClient({
  router: appRouter,
  baseUrl: "http://localhost:3000",
});

const user = await client.users.get({ params: { id: "1" } });
const users = await client.users.list();
```

Share `appRouter` (or the route handles) with callers. Mount groups before calling so path prefixes resolve. Non-2xx responses throw `ApiClientError` (`status`, `body`). Optional `fetch` replaces the global fetch. Optional client `headers` merge onto every call; per-call `params` / `query` / `body` / `headers` follow the route request schema.

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

Invalid input becomes a 400. Path params arrive percent-decoded (`/users/John%20Doe` gives `"John Doe"`). When several routes match a path, the most specific wins: per segment, a literal beats `:param`, which beats `*`. Query and header values are always strings; use schema coercion such as Zod's `z.stringbool()` when you want a boolean (`?draft=true` → `true`). Toggle validation with `new Api({ validation: false })` or `{ validation: { input: true, output: false } }`.

### Strict `c.json` typing

`c.json` rejects undeclared keys at compile time, including on nested objects, arrays, and union members, and including wider variables (for example a DB row with a `password` field). Discriminated-union member-specific keys stay valid. Pick or omit to the response shape before returning, or the type checker errors. Runtime output validation still runs separately unless you disable it.

### Route context

- **`c.req`** - validated `params`, `query`, `body`, `headers`, `cookies`
- **`c.raw`** - the underlying `Request`
- **`c.json` / `c.text` / `c.html` / `c.redirect`** - typed responses (`c.json` is strict against the declared response schema)
- **`c.header(name, value)`** - set a header on the returned response
- **`c.get(key)`** - values contributed by middleware

You can also return a plain string or object; Semola wraps it as a response.

## Error handling

Throw from a handler or middleware and map the error with `onError`. Declare `response` schemas so `c.json` stays typed and those statuses appear on every operation in the OpenAPI document.

```typescript
const api = new Api({
  onError: {
    response: {
      400: z.object({ message: z.string() }),
      500: z.object({ message: z.string() }),
    },
    handler: (c, err) => {
      if (err instanceof MyDomainError) {
        return c.json(400, { message: err.message });
      }

      return c.json(500, { message: "Internal server error" });
    },
  },
});
```

Input validation failures still return a fixed 400 `{ message }` via Semola; only thrown values go through `onError`.

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
    yield { comment: "keep-alive" };
  },
});
```

String `data` is sent raw; other values are JSON-encoded. Omit `data` and set `comment` to write SSE comment lines (for example heartbeats): `{ comment: "keep-alive" }` becomes `: keep-alive\n\n`.

`c.signal` aborts when the client disconnects (or when `c.raw.signal` aborts). `gen.return()` on cancel does not wake a suspended `await`, so race long waits against `c.signal` and return early - otherwise `finally` and subscription cleanup stay pending until that await settles.

```typescript
api.defineSSERoute({
  path: "/live",
  handler: async function* (c) {
    try {
      yield { event: "ready", data: "1" };

      while (!c.signal.aborted) {
        const event = await nextAppEvent({ signal: c.signal });
        yield { data: event };
      }
    } finally {
      // runs promptly when the client disconnects, if waits honor c.signal
    }
  },
});
```

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

Schemas with an `id` (for example Zod `.meta({ id: "User" })`) become shared entries in `components.schemas`. Request schemas use the input shape and responses use the output shape. When a schema is used in both directions and the shapes differ (defaults, transforms, Zod object `additionalProperties: false` on output), the response gets a separate `UserOutput` component (`UserOutput2` if that name is already taken). Schemas that reference a component with a separate output shape also get one.

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

### Start a server

`serve()` starts an HTTP server and resolves to `{ port, url, stop }`. The optional callback receives the same object. `stop()` lets in-flight requests finish; `stop(true)` closes every connection at once. On Bun it uses `Bun.serve`, on Node `node:http`. Both route through `api.fetch`, so matching and params behave the same on every runtime.

```typescript
const server = await api.serve(3000);

console.log(`Listening on ${server.url}`);

await server.stop();
```

### Other runtimes

Bun, Cloudflare Workers, and `deno serve` start a server for a module whose default export has a `fetch` method. `Api` has one, so export it instead of calling `serve()`:

```typescript
// server.ts
export default api;
```

Run it with `bun server.ts` (port from `PORT`, default 3000), deploy it as a Worker, or run `deno serve server.ts`.

`api.fetch` is a web-standard `(request: Request) => Response` handler, so it also works with any server that takes one:

```typescript
Bun.serve({ port: 3000, fetch: api.fetch });

Deno.serve({ port: 3000 }, api.fetch);
```

Node needs 22.3 or newer for `serve()`. On Node, `serve()` reads the whole request body before calling the handler and answers 413 past 128MB, the default limit of `Bun.serve`. Node's default `requestTimeout` (300 seconds to receive a whole request) also applies.

### Get Bun route handlers

`getRouteHandlers()` compiles registered routes into the `routes` map expected by `Bun.serve`, to use Bun's native router instead of `api.fetch`. Bun's router does not match trailing slashes (`/hello/` is a 404) and only sees routes registered before the call.

```typescript
const server = Bun.serve({
  port: 3000,
  routes: api.getRouteHandlers(),
  fetch: () => new Response("Not found", { status: 404 }),
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
| `onError` | - | Map thrown errors to Responses; optional `response` schemas for typing and OpenAPI |

### Methods

| Method | Meaning |
| --- | --- |
| `defineRoute(config)` | Register an HTTP route |
| `defineSSERoute(config)` | Register a GET SSE route |
| `mount(group)` | Mount a `Group` |
| `fetch(request)` | Handle a request without listening |
| `getRouteHandlers()` | Build the `routes` map for `Bun.serve` |
| `getOpenApiSpec()` | Build the OpenAPI document |
| `serve(port, callback?)` | Start a server on Bun (`Bun.serve`) or Node (`node:http`) |

There is no `listen` method.

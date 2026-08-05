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

```typescript
api.defineRoute({
  path: "/posts",
  method: "POST",
  request: {
    body: z.object({ title: z.string(), body: z.string() }),
    query: z.object({ draft: z.boolean().optional() }),
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

Invalid input becomes a 400. Toggle validation with `new Api({ validation: false })` or `{ validation: { input: true, output: false } }`.

### Route context

- **`c.req`** - validated `params`, `query`, `body`, `headers`, `cookies`
- **`c.raw`** - the underlying `Request`
- **`c.json` / `c.text` / `c.html` / `c.redirect`** - typed responses
- **`c.get(key)`** - values contributed by middleware

You can also return a plain string or object; Semola wraps it as a response.

## Middleware

Middleware can validate, short-circuit with a `Response`, or attach typed data to the context:

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
  middlewares: [auth],
  handler: async (c) => {
    return c.json(200, { userId: c.get("userId") });
  },
});
```

Pass middleware on the API (`new Api({ middlewares: [...] })`), a group, or a single route.

## Groups

Share a path prefix and middleware across routes:

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

### Example: Authenticated route

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
  middlewares: [auth],
  response: {
    200: z.object({ userId: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, { userId: c.get("userId") });
  },
});
```

### Example: Nested groups

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

### Example: OpenAPI + fetch in tests

```typescript
const api = new Api({
  openapi: { title: "Users", version: "1.0.0" },
});

api.defineRoute({
  path: "/health",
  method: "GET",
  summary: "Health check",
  handler: () => ({ ok: true }),
});

const res = await api.fetch(new Request("http://localhost/health"));
expect(res.status).toBe(200);

const spec = api.getOpenApiSpec();
expect(spec.info.title).toBe("Users");
```

### Example: Disable output validation

```typescript
const api = new Api({
  validation: { input: true, output: false },
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
| `getOpenApiSpec()` | Build the OpenAPI document |
| `serve(port, callback?)` | Start `Bun.serve` |

There is no `listen` method.

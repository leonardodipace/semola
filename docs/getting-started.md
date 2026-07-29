---
title: Getting Started
description: Install Semola and run your first typed API
---

## Install

```bash
bun add semola
```

npm, pnpm, and yarn work too:

```bash
npm install semola
```

Some packages need runtime-native clients (HTTP server, Redis, SQL, cron). Each package page calls that out when it matters.

## A tiny API that actually runs

```typescript
import { Api } from "semola/api";
import { z } from "zod";

const api = new Api();

api.defineRoute({
  path: "/hello/:name",
  method: "GET",
  request: {
    params: z.object({ name: z.string() }),
  },
  response: {
    200: z.object({ message: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, {
      message: `Hello, ${c.req.params.name}!`,
    });
  },
});

api.serve(3000);
```

Open `http://localhost:3000/hello/world`. Params and responses are validated. Generate an OpenAPI document anytime with `api.getOpenApiSpec()`.

Path params, query, body, headers, and cookies live on **`c.req`**. Use `c.json`, `c.text`, `c.html`, or `c.redirect` to respond.

## Errors without try/catch

```typescript
import { mightThrow } from "semola/errors";

const [error, data] = await mightThrow(fetch("https://api.example.com"));

if (error) {
  console.error("Request failed:", error);
  return;
}

console.log("Success:", data);
```

After the `if (error)` check, TypeScript knows `data` is defined.

## Where to go next

- [API](/docs/api) - middleware, groups, OpenAPI
- [Errors](/docs/errors) - result tuples and `mightThrow`
- [Queue](/docs/queue) - Redis-backed background jobs
- [ORM](/docs/orm) - typed tables and queries

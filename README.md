<div align="center">

<img src="./logo.png" alt="Semola" width="150">

# Semola

**Type-safe backend toolkit, zero dependencies**

Most backends end up stitching a router, a queue, an ORM, and a validator - each with its own types. Semola is one TypeScript package instead: REST APIs with OpenAPI, Redis queues, durable workflows, SQL, auth, cache, i18n, and more. Empty `dependencies` field. Import only what you use (`semola/api`, `semola/queue`, `semola/orm`, ...).

**Docs:** [semo.la](https://semo.la) · **npm:** [semola](https://www.npmjs.com/package/semola) · **Install:** `bun add semola`

[![Tests](https://img.shields.io/github/actions/workflow/status/leonardodipace/semola/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/leonardodipace/semola/actions)
[![npm version](https://img.shields.io/npm/v/semola.svg?style=flat-square)](https://www.npmjs.com/package/semola)
[![Docs](https://img.shields.io/badge/docs-semo.la-0ea5e9?style=flat-square)](https://semo.la)
[![Bun](https://img.shields.io/badge/Bun-1.1%2B-black?style=flat-square&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/npm/l/semola.svg?style=flat-square)](LICENSE)

</div>

## Modules

| Module | What it does | Import |
| ------ | ------------ | ------ |
| **API** | Typed REST routes, OpenAPI, typed client | `semola/api` |
| **Queue** | Redis jobs with retries, timeouts, reclaim | `semola/queue` |
| **PubSub** | Typed channels on Redis or in memory | `semola/pubsub` |
| **Workflow** | Multi-step work that resumes after a crash | `semola/workflow` |
| **ORM** | Tables, queries, migrations for SQLite and Postgres | `semola/orm` |
| **Cache** | Typed Redis values with TTL | `semola/cache` |
| **Cron** | In-process or OS-level schedules | `semola/cron` |
| **Policy** | Allow / forbid auth rules | `semola/policy` |
| **i18n** | Translation keys the compiler can reject | `semola/i18n` |
| **Schema** | Built-in Standard Schema + JSON Schema | `semola/schema` |
| **Errors** | `[error, data]` tuples instead of try/catch nests | `semola/errors` |
| **Logging** | Prefixed loggers to console or files | `semola/logging` |
| **Otel** | OTLP traces, metrics, and logs over HTTP JSON | `semola/otel` |
| **CLI** | Commands and flags with schema validation | `semola/cli` |
| **Prompts** | Interactive terminal prompts | `semola/prompts` |
| **Extra** | Backoff retries and small helpers | `semola/extra` |

---

## Quick start

```bash
bun add semola

# or: npm install semola
```

### Typed API

```typescript
import { Api } from "semola/api";
import { object, string } from "semola/schema";

const api = new Api();

api.defineRoute({
  path: "/hello/:name",
  method: "GET",
  request: {
    params: object({ name: string() }),
  },
  response: {
    200: object({ message: string() }),
  },
  handler: async (ctx) => {
    return ctx.json(200, { message: `Hello, ${ctx.req.params.name}!` });
  },
});

api.serve(3000);
console.log("Server running on http://localhost:3000");
```

### Handle Errors Without Try-Catch

```typescript
import { mightThrow } from "semola/errors";

const [error, data] = await mightThrow(fetch("https://api.example.com"));

if (error) {
  console.error("Request failed:", error);
  return;
}

console.log("Success:", data);
```

`mightThrow` and `mightThrowSync` default their error type to `Error`. If a promise or function can reject or throw non-Error values, pass a custom error generic.

```typescript
const [customError] = await mightThrow<never, { code: string }>(
  Promise.reject({ code: "RATE_LIMITED" }),
);
```

### Process Background Jobs

```typescript
import { Queue } from "semola/queue";

const queue = new Queue({
  name: "emails",
  redis: redisClient,
  handler: async (data) => {
    await sendEmail(data);
  },
});

await queue.enqueue({ to: "user@example.com", subject: "Hello" });
```

### Send Real-Time Messages

```typescript
import { PubSub } from "semola/pubsub";

const pubsub = new PubSub({
  subscriber: redisSubscriber,
  publisher: redisPublisher,
  channel: "notifications",
});

// Subscribe to messages
const unsubscribe = await pubsub.subscribe((message) => {
  console.log("Received:", message);
});

// Publish a message
await pubsub.publish({ userId: 123, text: "New alert!" });

await unsubscribe();
```

### Cache Data with TTL

```typescript
import { Cache } from "semola/cache";

const cache = new Cache({
  redis: redisClient,
  ttl: 3600000, // 1 hour in milliseconds
});

// Store data
await cache.set("user:123", { name: "John", age: 30 });

// Retrieve data
const user = await cache.get("user:123");
console.log(user);
```

### Schedule Recurring Tasks

```typescript
import { Cron } from "semola/cron";

const cleanup = new Cron({
  name: "daily-cleanup",
  schedule: "@daily",
  handler: async () => {
    await deleteOldLogs();
    await archiveInactiveUsers();
  }
});

cleanup.run();

```

### Query a Database

```typescript
import { createOrm, defineTable, json, string, uuid } from "semola/orm";

const users = defineTable({
  sqlName: "users",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    name: string("name").notNull(),
    email: string("email").unique().notNull(),
    metadata: json<{ plan: string }>("metadata"),
  },
});

const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users },
});

const rows = await db.users.findMany({
  where: { name: { contains: "John" } },
  take: 10,
});

const user = await db.users.create({
  data: {
    id: "1",
    name: "John Doe",
    email: "john@example.com",
  },
});

console.log(rows, user);
```

### Check Permissions

```typescript
import { Policy, eq, has } from "semola/policy";

type User = { id: number; role: string; permissions: string[] };

const policy = new Policy<User>();

// Allow admins full access
policy.allow({
  action: ["create", "update", "delete"],
  conditions: { role: eq("admin") },
  reason: "Admins have full access",
});

// Allow users with a specific permission
policy.allow({
  action: "read",
  conditions: { permissions: has("posts:read") },
});

// Check if user can perform an action
const user: User = { id: 1, role: "admin", permissions: [] };
const result = policy.can("update", user);
console.log(result.allowed); // true
```

### Internationalize Your App

```typescript
import { I18n } from "semola/i18n";

const i18n = new I18n({
  defaultLocale: "en",
  locales: {
    en: { greeting: "Hello, {name:string}!" },
    es: { greeting: "¡Hola, {name:string}!" },
  },
});

console.log(i18n.translate("greeting", { name: "World" }));
```

### Log your messages

```typescript
import { ConsoleProvider, Logger } from "semola/logging";

const logger = new Logger("database", [new ConsoleProvider()]);
logger.info("Hello!");
```

### Retry a function multiple times

```typescript
import { createRetry } from "semola/extra";

type FriendRequest = {
  from: string;
  to: string;
};

async function sendFriendRequest(req: FriendRequest) {
  console.log(`sending from ${req.from} to ${req.to}`);
  await sender(req);
}

const callable = createRetry({
  input: async () => {
    await sendFriendRequest({ from: "user1@gmail.com", to: "user2@gmail.com" });
  },
  maxRetries: 3,
  onFailedAttempt: () => {
    console.log(`Resending the request`);
  },
  onError: ({ error }) => {
    console.error(error.message);
  },
});

const outcome = await callable();
if (outcome.ok) {
  console.log("sent");
}
```

---

## 📦 Installation

```bash
# Install core package (validation built in via semola/schema)
bun add semola

# Optional: another Standard Schema library (Zod, Valibot, ArkType)
# bun add zod
```

---

## 🔥 Why Semola?

**Semola** (pronounced "seh-MOH-lah") is the batteries-included toolkit TypeScript developers have been waiting for.

Stop piecing together half-baked solutions from npm. Stop wrestling with type definitions that lie to you. Semola gives you everything you need to build production-ready Bun applications with confidence: type-safe APIs, background job queues, real-time messaging, caching, authorization, and error handling. All working together seamlessly out of the box.

### API Framework Comparison

|                       | Semola | Express | Fastify | Hono | Elysia |
| --------------------- | :----: | :-----: | :-----: | :--: | :----: |
| **Bun Native**        |   ✅   |   ❌    |   ⚠️    |  ✅  |   ✅   |
| **Zero Dependencies** |   ✅   |   ❌    |   ❌    |  ✅  |   ❌   |
| **Type-Safe Routes**  |   ✅   |   ❌    |   ⚠️    |  ✅  |   ✅   |
| **Auto OpenAPI**      |   ✅   |   ❌    |   ⚠️    |  ⚠️  |   ⚠️   |
| **Tree-Shakeable**    |   ✅   |   ❌    |   ❌    |  ✅  |   ✅   |
| **Standard Schema**   |   ✅   |   ❌    |   ❌    |  ⚠️  |   ✅   |

### Performance Benchmarks

Semola API is the **fastest API framework** for Bun.

| Framework  | Avg Req/Sec | Latency Avg (ms) |  vs Semola   |
| :--------- | ----------: | ---------------: | :----------: |
| **Semola** |  **40,050** |         **1.88** | **baseline** |
| Elysia     |      37,185 |             2.13 | 1.1x slower  |
| Hono       |      34,611 |             2.31 | 1.2x slower  |
| Fastify    |      26,330 |             3.70 | 1.5x slower  |
| Express    |      20,031 |             5.02 |  2x slower   |
| NestJS     |      16,118 |             6.21 | 2.5x slower  |

_Higher is better for req/sec, lower is better for latency._

### What Makes Semola Different

- 🎯 **Bun-first**: Engineered specifically for Bun's performance. No Node.js baggage.
- 🧩 **Modular by design**: Import only what you need. Your bundle stays lean.
- 🔒 **Type safety that actually works**: From request validation to response serialization, TypeScript catches errors before they hit production.
- 📄 **Documentation writes itself**: Auto-generated OpenAPI specs from your code. No more stale docs.
- 🚫 **Error handling reimagined**: No more try-catch spaghetti. Clean result tuples that compose beautifully.
- ⚡ **Schema validation freedom**: Use `semola/schema`, Zod, Valibot, ArkType, or any Standard Schema library. Your choice.
- 🔋 **Batteries included**: Everything you need in one cohesive toolkit. No 50 dependencies to audit.

---

## 📖 Documentation

Full docs: **[https://semo.la](https://semo.la)** · Getting started: **[https://semo.la/docs/getting-started](https://semo.la/docs/getting-started)**

Run locally: `bun run docs:dev` (http://localhost:3000).

- [API Framework](https://semo.la/docs/api) - Type-safe REST API framework with OpenAPI
- [Queue](https://semo.la/docs/queue) - Redis-backed job queue with timeouts & concurrency
- [PubSub](https://semo.la/docs/pubsub) - Type-safe Redis pub/sub
- [Cron](https://semo.la/docs/cron) - In-memory and OS cron scheduler for periodic task execution
- [Workflow](https://semo.la/docs/workflow) - Durable and resumable workflows with retries and hooks
- [Policy](https://semo.la/docs/policy) - Policy-based authorization
- [i18n](https://semo.la/docs/i18n) - Type-safe internationalization
- [Cache](https://semo.la/docs/cache) - Redis cache wrapper with TTL
- [Schema](https://semo.la/docs/schema) - Standard Schema validation with JSON Schema output
- [Errors](https://semo.la/docs/errors) - Result-based error handling
- [Logging](https://semo.la/docs/logging) - Logging utility
- [Otel](https://semo.la/docs/otel) - Zero-dependency OTLP/HTTP JSON traces, metrics, and logs
- [Prompts](https://semo.la/docs/prompts) - Interactive CLI prompts
- [CLI](https://semo.la/docs/cli) - Non-interactive CLI builder
- [ORM](https://semo.la/docs/orm) - Type-safe data layer with SQLite and Postgres
- [Extra](https://semo.la/docs/extra) - A collection of tiny utilities

---

## 🛠️ Development

```bash
# Install dependencies
bun install

# Run docs site
bun run docs:dev

# Run tests
bun test

# Build package
bun run build

# Lint & typecheck
bun check
```

---

## 📝 Publishing

Pushing a new `package.json` version to `main` publishes to npm (with provenance) and creates a GitHub Release.

**Stable** (`latest`):

```bash
bun pm version <major|minor|patch>
git push
```

**Beta** (`beta` dist-tag + GitHub Pre-release). Any version with a `-` suffix (e.g. `0.7.0-beta.0`) uses this path:

```bash
bun pm version preminor --preid beta   # first beta of next minor (0.6.6 → 0.7.0-beta.0)
bun pm version prerelease --preid beta # later betas (0.7.0-beta.0 → 0.7.0-beta.1)
git push
```

Install a beta with `bun add semola@beta`. Promote to stable with a clean version (no suffix), e.g. `bun pm version 0.7.0`. That moves npm `latest`; the `beta` dist-tag stays on the last prerelease until the next beta. Stable GitHub release notes cover everything since the last stable tag (betas included).

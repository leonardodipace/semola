<div align="center">

<img src="./logo.png" alt="Semola" width="150">

# Semola

⚡ **Zero-dependency TypeScript utilities for modern Bun apps**

Type-safe APIs, Redis queues, pub/sub, i18n, caching & auth with tree-shakeable imports

[![Tests](https://img.shields.io/github/actions/workflow/status/leonardodipace/semola/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/leonardodipace/semola/actions)
[![npm version](https://img.shields.io/npm/v/semola.svg?style=flat-square)](https://www.npmjs.com/package/semola)
[![Bun](https://img.shields.io/badge/Bun-1.1%2B-black?style=flat-square&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/npm/l/semola.svg?style=flat-square)](LICENSE)

</div>

## ✨ Features

| Module               | Description                                            | Import          |
| -------------------- | ------------------------------------------------------ | --------------- |
| **🚀 API Framework** | Type-safe REST API with OpenAPI & Bun-native routing   | `semola/api`    |
| **📬 Queue**         | Redis-backed job queue with timeouts & concurrency     | `semola/queue`  |
| **📡 PubSub**        | Type-safe Redis pub/sub for real-time messaging        | `semola/pubsub` |
| **🔐 Policy**        | Policy-based authorization with type-safe guards       | `semola/policy` |
| **🌍 i18n**          | Compile-time validated internationalization            | `semola/i18n`   |
| **💾 Cache**         | Redis cache wrapper with TTL & automatic serialization | `semola/cache`  |
| **⚠️ Errors**        | Result-based error handling without try/catch          | `semola/errors` |

---

## 🚀 Quick Start

```bash
# With Bun (recommended)
bun add semola

# With npm
npm install semola
```

### Build a Type-Safe API

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
  handler: async (ctx) => {
    return ctx.json(200, { message: `Hello, ${ctx.params.name}!` });
  },
});

api.listen(3000);
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
  subscriber: redisClient,
  publisher: redisClient,
  channel: "notifications",
});

// Subscribe to messages
await pubsub.subscribe((message) => {
  console.log("Received:", message);
});

// Publish a message
await pubsub.publish({ userId: 123, text: "New alert!" });
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
const [error, user] = await cache.get("user:123");
if (!error) console.log(user);
```

### Check Permissions

```typescript
import { Policy } from "semola/policy";

const policy = new Policy();

// Allow admins to edit any post
policy.allow({
  action: "update",
  entity: "post",
  conditions: { role: "admin" },
  reason: "Admins can edit any post",
});

// Check if user can edit
const result = policy.can("update", "post", { role: user.role });
console.log(result.allowed); // true or false
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

---

## 📦 Installation

```bash
# Install core package
bun add semola

# Optional: Install validation library (Zod, Valibot, ArkType)
bun add zod
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

### What Makes Semola Different

- 🎯 **Bun-first**: Engineered specifically for Bun's performance. No Node.js baggage.
- 🧩 **Modular by design**: Import only what you need. Your bundle stays lean.
- 🔒 **Type safety that actually works**: From request validation to response serialization, TypeScript catches errors before they hit production.
- 📄 **Documentation writes itself**: Auto-generated OpenAPI specs from your code. No more stale docs.
- 🚫 **Error handling reimagined**: No more try-catch spaghetti. Clean result tuples that compose beautifully.
- ⚡ **Schema validation freedom**: Use Zod, Valibot, ArkType, or any Standard Schema library. Your choice.
- 🔋 **Batteries included**: Everything you need in one cohesive toolkit. No 50 dependencies to audit.

---

## 📖 Documentation

- [API Framework](./docs/api.md) - Type-safe REST API framework with OpenAPI
- [Queue](./docs/queue.md) - Redis-backed job queue with timeouts & concurrency
- [PubSub](./docs/pubsub.md) - Type-safe Redis pub/sub
- [Policy](./docs/policy.md) - Policy-based authorization
- [i18n](./docs/i18n.md) - Type-safe internationalization
- [Cache](./docs/cache.md) - Redis cache wrapper with TTL
- [Errors](./docs/errors.md) - Result-based error handling

---

## 🛠️ Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build package
bun run build

# Lint & typecheck
bun check
```

---

## 📝 Publishing

This package uses GitHub Actions for automated publishing. To release:

1. Bump version: `bun version <major|minor|patch>`
2. Create a GitHub release with a new tag (e.g., `v0.4.0`)
3. The GitHub Action automatically publishes to npm with provenance

---
title: Cache
description: Typed Redis cache with TTL and optional key prefix
---

Store and load typed values in Redis. Values are JSON by default.

Needs a `Bun.RedisClient`.

## Import

```typescript
import { Cache } from "semola/cache";
```

## Quick start

This stores a typed user for one minute, reads it from the prefixed Redis key, then deletes it.

```typescript
const users = new Cache<{ name: string; email: string }>({
  redis: redisClient,
  ttl: 60_000, // milliseconds (Redis PX)
  prefix: "user",
});

await users.set("1", { name: "Ada", email: "ada@example.com" });

const user = await users.get("1");
// key in Redis: "user:1"

await users.delete("1");
```

`get` throws if the key is missing. `ttl` can be a number or `(key, value) => number`. Omit it (or pass `null` / `undefined`) for no expiry.

## Soft-disable

This cache performs no writes or deletes, and every read behaves like a miss.

```typescript
const cache = new Cache({
  redis: redisClient,
  enabled: false,
});
```

When `enabled` is `false`, `set` / `delete` are no-ops and `get` behaves as a miss. Handy for local feature flags without branching call sites.

## Custom serialization

Pass `serializer` / `deserializer` if JSON is not enough. Keep them inverse of each other.

## Examples

### Store a value with `set()`

`set()` serializes the value, applies the configured TTL, and returns the original typed value.

```typescript
await users.set("1", { name: "Ada", email: "ada@example.com" });
```

### Read a value with `get()`

`get()` resolves the prefixed key, deserializes its value, and throws on a miss.

```typescript
const user = await users.get("1");
```

### Remove a value with `delete()`

`delete()` removes the resolved Redis key and returns Redis's deletion count.

```typescript
const deleted = await users.delete("1");
```

### Dynamic TTL

The TTL callback keeps admin sessions for one hour and all other sessions for one minute.

```typescript
const sessions = new Cache<{ userId: string }>({
  redis: redisClient,
  prefix: "session",
  ttl: (_key, value) => (value.userId.startsWith("admin:") ? 3_600_000 : 60_000),
});
```

### Soft-disable in development

The same call sites keep working in development, but cache operations only reach Redis in production.

```typescript
const cache = new Cache({
  redis: redisClient,
  enabled: process.env.NODE_ENV === "production",
  prefix: "user",
});
```

### Custom serializer

Values are encoded as base64 before storage and restored to `Uint8Array` after reading.

```typescript
const blobs = new Cache<Uint8Array>({
  redis: redisClient,
  serializer: (value) => Buffer.from(value).toString("base64"),
  deserializer: (raw) => new Uint8Array(Buffer.from(raw, "base64")),
});
```

## Reference

| Option | Default | Meaning |
| --- | --- | --- |
| `redis` | required | `Bun.RedisClient` |
| `ttl` | none | ms, or `(key, value) => number`; invalid values throw |
| `enabled` | `true` | Soft on/off switch |
| `prefix` | - | Key prefix (`prefix:key`) |
| `serializer` | `JSON.stringify` | Value → string |
| `deserializer` | `JSON.parse` | String → value |

### Methods

| Method | Meaning |
| --- | --- |
| `get(key)` | Load value; throws on miss |
| `set(key, value)` | Store value |
| `delete(key)` | Remove key |

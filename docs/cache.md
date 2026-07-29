---
title: Cache
description: Typed Redis cache with TTL and optional key prefix
---

Store and load typed values in Redis. Values are JSON by default.

```typescript
import { Cache } from "semola/cache";
```

Needs a `Bun.RedisClient`.

## Usage

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

`get` throws if the key is missing. `ttl` can be a number or `(key, value) => number`. Omit it (or pass `null`/`undefined`) for no expiry.

## Soft-disable

```typescript
const cache = new Cache({
  redis: redisClient,
  enabled: false,
});
```

When `enabled` is `false`, `set` is a no-op and `get` behaves as a miss. Handy for local feature flags without branching call sites.

## Custom serialization

Pass `serializer` / `deserializer` if JSON is not enough. Keep them inverse of each other.

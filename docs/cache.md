# Cache

A type-safe Redis cache wrapper with TTL support and result-based error handling. Built on Bun's native Redis client.

## Import

```typescript
import { Cache } from "semola/cache";
```

## API

**`new Cache<T>(options: CacheOptions<T>)`**

Creates a new cache instance.

```typescript
type CacheError = "CacheError" | "InvalidTTLError";

type CacheOptions<T> = {
  redis: Bun.RedisClient;
  ttl?: number | ((key: string, value: T) => number); // TTL in ms, or per-entry function
  enabled?: boolean; // Enable/disable caching (default: true)
  prefix?: string; // Key prefix, e.g. "users" -> "users:key"
  serializer?: (value: T) => string; // Custom serializer (default: JSON.stringify)
  deserializer?: (raw: string) => T; // Custom deserializer (default: JSON.parse)
  onError?: (error: { type: CacheError; message: string }) => void; // Error callback
};

const cache = new Cache<User>({
  redis: redisClient,
  ttl: 60000,
  prefix: "users",
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

Stores a value in the cache with serialization. Applies TTL if configured.

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

## Usage Example

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
  ttl: 300000, // 5 minutes
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

### Prefix

When a `prefix` is provided, all keys are automatically prefixed with `prefix:key`:

```typescript
const usersCache = new Cache<User>({
  redis: redisClient,
  prefix: "users",
});

await usersCache.set("123", user); // Stored as "users:123"
await usersCache.get("123"); // Reads from "users:123"
await usersCache.delete("123"); // Deletes "users:123"
```

### Enabled

When `enabled` is set to `false`, all cache operations become no-ops:

- `get` returns a `NotFoundError` (cache miss)
- `set` returns the value without storing it
- `delete` returns `0` without deleting

```typescript
const cache = new Cache<User>({
  redis: redisClient,
  enabled: process.env.CACHE_ENABLED !== "false",
});
```

### Serializer / Deserializer

Replace the default JSON serialization with custom functions:

```typescript
const cache = new Cache<User>({
  redis: redisClient,
  serializer: (user) => `${user.id}:${user.name}`,
  deserializer: (raw) => {
    const [id, name] = raw.split(":");
    return { id: Number(id), name };
  },
});
```

### TTL as Function

Compute TTL per entry based on key and value:

```typescript
const cache = new Cache<Session>({
  redis: redisClient,
  ttl: (_key, session) => (session.rememberMe ? 86400000 : 3600000),
});
```

- `ttl: 0` is treated as a valid TTL and passed to Redis as `PX 0`.
- If the TTL function throws, `set` returns `InvalidTTLError` (and triggers `onError` when configured).

### onError

Receive a callback on unexpected errors (`CacheError`, `InvalidTTLError`). Not called on `NotFoundError` (normal cache miss).

```typescript
const cache = new Cache<User>({
  redis: redisClient,
  onError: (error) => logger.warn(`Cache: ${error.type} - ${error.message}`),
});
```

**Note on lifecycle management:** The `Cache` class does not manage the Redis client lifecycle. Since you provide the client when creating the cache, you're responsible for closing it when done:

```typescript
const redis = new Bun.RedisClient("redis://localhost:6379");
const cache = new Cache({ redis });

// Use the cache...

// Clean up when done
await redis.quit();
```

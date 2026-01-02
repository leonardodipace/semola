# Cache

A type-safe Redis cache wrapper with TTL support and result-based error handling. Built on Bun's native Redis client.

## Import

```typescript
import { Cache } from "semola/cache";
```

## API

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

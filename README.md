# @leonardodipace/kit

A TypeScript utility kit providing type-safe error handling and developer tools.

## Installation

```bash
npm install @leonardodipace/kit
```

```bash
bun add @leonardodipace/kit
```

## Features

### Cache

A type-safe Redis cache wrapper with TTL support and result-based error handling. Built on Bun's native Redis client.

#### Import

```typescript
import { Cache } from '@leonardodipace/kit/cache';
```

#### API

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
const [error, user] = await cache.get('user:123');

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
const [error, data] = await cache.set('user:123', { id: 123, name: "John" });

if (error) {
  console.error("Failed to cache:", error.message);
} else {
  console.log("Cached successfully");
}
```

**`cache.delete(key: string)`**

Removes a key from the cache.

```typescript
const [error] = await cache.delete('user:123');

if (error) {
  console.error("Failed to delete:", error.message);
}
```

#### Usage Example

```typescript
import { Cache } from '@leonardodipace/kit/cache';

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

### Error Utilities

Result-based error handling inspired by functional programming patterns. Avoid throwing exceptions and handle errors explicitly with type-safe tuples.

#### Import

```typescript
import { ok, err, mightThrow, mightThrowSync } from '@leonardodipace/kit/errors';
```

#### API

**`ok<T>(data: T)`**

Creates a successful result tuple.

```typescript
const result = ok({ userId: 123, name: "John" });
// [null, { userId: 123, name: "John" }]

const [error, data] = result;

if (error) {
  // Handle error
} else {
  console.log(data.userId); // Type-safe access
}
```

**`err<T>(type: T, message: string)`**

Creates an error result tuple with a typed error object.

```typescript
const result = err("NotFoundError", "User not found");
// [{ type: "NotFoundError", message: "User not found" }, null]

const [error, data] = result;

if (error) {
  console.log(error.type);    // "NotFoundError"
  console.log(error.message); // "User not found"
}
```

**Common error types:** `NotFoundError`, `UnauthorizedError`, `InternalServerError`, `ValidationError`, or any custom string.

**`mightThrow<T>(promise: Promise<T>)`**

Wraps async operations that might throw into result tuples.

```typescript
const [error, data] = await mightThrow(fetch('/api/users'));

if (error) {
  console.error("Request failed:", error);
  return;
}

console.log("Success:", data);
```

**`mightThrowSync<T>(fn: () => T)`**

Wraps synchronous operations that might throw into result tuples.

```typescript
const [error, data] = mightThrowSync(() => JSON.parse(input));

if (error) {
  console.error("Parse failed:", error);
  return;
}

console.log("Parsed:", data);
```

#### Usage Example

```typescript
import { ok, err, mightThrow } from '@leonardodipace/kit/errors';

async function getUser(id: string) {
  if (!id) {
    return err("ValidationError", "User ID is required");
  }

  const [fetchError, response] = await mightThrow(
    fetch(`/api/users/${id}`)
  );

  if (fetchError) {
    return err("InternalServerError", "Failed to fetch user");
  }

  const [parseError, user] = await mightThrow(response.json());

  if (parseError) {
    return err("InternalServerError", "Invalid response format");
  }

  return ok(user);
}

// Usage
const [error, user] = await getUser("123");

if (error) {
  switch (error.type) {
    case "ValidationError":
      console.log("Validation failed:", error.message);
      break;
    case "NotFoundError":
      console.log("User not found");
      break;
    default:
      console.log("Error:", error.message);
  }
} else {
  console.log("User:", user);
}
```

## Development

```bash
# Install dependencies
bun install

# Build package
bun run build

# Build types
bun run build:types
```

## License

MIT © Leonardo Dipace

## Repository

[https://github.com/leonardodipace/kit](https://github.com/leonardodipace/kit)

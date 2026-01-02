import { describe, expect, test } from "bun:test";
import { Cache } from "./index.js";

// Mock Redis client for testing
class MockRedisClient {
  private store = new Map<string, string>();
  private shouldFail = false;

  public setShouldFail(value: boolean) {
    this.shouldFail = value;
  }

  public async get(key: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    return this.store.get(key);
  }

  public async set(key: string, value: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    this.store.set(key, value);

    return "OK";
  }

  public async del(key: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    const existed = this.store.has(key);

    if (!existed) {
      return 0;
    }

    this.store.delete(key);

    return 1;
  }

  public clear() {
    this.store.clear();
  }

  public getStore() {
    return this.store;
  }
}

// Helper to create a properly typed mock redis client for testing
const createMockRedis = () => {
  return new MockRedisClient() as MockRedisClient & Bun.RedisClient;
};

describe("Cache", () => {
  describe("get", () => {
    test("should retrieve and parse a cached value", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis });

      await redis.set("user:1", JSON.stringify({ name: "John" }));

      const [error, data] = await cache.get("user:1");
      expect(error).toBeNull();
      expect(data).toEqual({ name: "John" });
    });

    test("should return NotFoundError when key does not exist", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      const [error, data] = await cache.get("nonexistent");
      expect(error).toEqual({
        type: "NotFoundError",
        message: "Key nonexistent not found",
      });
      expect(data).toBeNull();
    });

    test("should return CacheError on Redis connection failure", async () => {
      const redis = createMockRedis();
      redis.setShouldFail(true);
      const cache = new Cache<string>({ redis });

      const [error, data] = await cache.get("key");
      expect(error).toEqual({
        type: "CacheError",
        message: "Unable to get value for key key",
      });
      expect(data).toBeNull();
    });

    test("should return CacheError on invalid JSON", async () => {
      const redis = createMockRedis();
      const cache = new Cache<object>({ redis });

      await redis.set("invalid", "not valid json {");

      const [error, data] = await cache.get("invalid");
      expect(error).toEqual({
        type: "CacheError",
        message: "Unable to parse value for key invalid",
      });
      expect(data).toBeNull();
    });

    test("should work with different data types", async () => {
      const redis = createMockRedis();

      // Test with number
      const numberCache = new Cache<number>({ redis });
      await redis.set("number", "42");
      const [, num] = await numberCache.get("number");
      expect(num).toBe(42);

      // Test with boolean
      const boolCache = new Cache<boolean>({ redis });
      await redis.set("bool", "true");
      const [, bool] = await boolCache.get("bool");
      expect(bool).toBe(true);

      // Test with array
      const arrayCache = new Cache<number[]>({ redis });
      await redis.set("array", JSON.stringify([1, 2, 3]));
      const [, arr] = await arrayCache.get("array");
      expect(arr).toEqual([1, 2, 3]);

      // Test with nested object
      const objCache = new Cache<{ user: { name: string; age: number } }>({
        redis,
      });
      await redis.set(
        "nested",
        JSON.stringify({ user: { name: "Alice", age: 30 } }),
      );
      const [, obj] = await objCache.get("nested");
      expect(obj).toEqual({ user: { name: "Alice", age: 30 } });
    });
  });

  describe("set", () => {
    test("should store a value in cache", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis });

      const [error, data] = await cache.set("user:1", { name: "John" });
      expect(error).toBeNull();
      expect(data).toEqual({ name: "John" });

      const stored = redis.getStore().get("user:1");
      expect(stored).toBe(JSON.stringify({ name: "John" }));
    });

    test("should handle NaN", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ id: number }>({ redis });

      const [error, data] = await cache.set("user:id", { id: NaN });
      expect(error).toBeNull();
      expect(data).toEqual({ id: NaN });

      const stored = redis.getStore().get("user:id");
      expect(stored).toBe(JSON.stringify({ id: NaN }));
    });

    test("should store value with TTL when provided", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, ttl: 5000 });

      const [error, data] = await cache.set("key", "value");
      expect(error).toBeNull();
      expect(data).toBe("value");
    });

    test("should return CacheError on stringify failure", async () => {
      const redis = createMockRedis();
      type CircularType = { a: number; self?: CircularType };
      const cache = new Cache<CircularType>({ redis });

      // Create circular reference that cannot be stringified
      const circular: CircularType = { a: 1 };
      circular.self = circular;

      const [error, data] = await cache.set("circular", circular);
      expect(error).toEqual({
        type: "CacheError",
        message: "Unable to stringify value for key circular",
      });
      expect(data).toBeNull();
    });

    test("should return CacheError on Redis connection failure", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      redis.setShouldFail(true);

      const [error, data] = await cache.set("key", "value");
      expect(error).toEqual({
        type: "CacheError",
        message: "Unable to set value for key key",
      });
      expect(data).toBeNull();
    });

    test("should work with different data types", async () => {
      const redis = createMockRedis();

      // Number
      const numCache = new Cache<number>({ redis });
      const [, num] = await numCache.set("num", 42);
      expect(num).toBe(42);
      expect(redis.getStore().get("num")).toBe("42");

      // Boolean
      const boolCache = new Cache<boolean>({ redis });
      const [, bool] = await boolCache.set("bool", false);
      expect(bool).toBe(false);
      expect(redis.getStore().get("bool")).toBe("false");

      // Array
      const arrCache = new Cache<string[]>({ redis });
      const [, arr] = await arrCache.set("arr", ["a", "b", "c"]);
      expect(arr).toEqual(["a", "b", "c"]);
      expect(redis.getStore().get("arr")).toBe('["a","b","c"]');

      // Object
      const objCache = new Cache<{ key: string }>({
        redis,
      });
      const [, obj] = await objCache.set("obj", { key: "value" });
      expect(obj).toEqual({ key: "value" });
      expect(redis.getStore().get("obj")).toBe('{"key":"value"}');
    });

    test("should return InvalidTTLError on negative TTL", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis, ttl: -1 });

      const [error, data] = await cache.set("user:1", { name: "John" });
      expect(error).toEqual({
        type: "InvalidTTLError",
        message: "Unable to save records with ttl equal to -1",
      });
      expect(data).toBeNull();
    });

    test("should return InvalidTTLError on non integer TTL", async () => {
      const redis = createMockRedis();
      const nonIntegerTTL = 0.1 + 0.2;
      const cache = new Cache<{ name: string }>({ redis, ttl: nonIntegerTTL });

      const [error, data] = await cache.set("user:1", { name: "John" });
      expect(error).toEqual({
        type: "InvalidTTLError",
        message: `Unable to save records with ttl equal to ${nonIntegerTTL}`,
      });
      expect(data).toBeNull();
    });

    test("should return InvalidTTLError on NaN TTL", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis, ttl: NaN });

      const [error, data] = await cache.set("user:1", { name: "John" });

      expect(error).toEqual({
        type: "InvalidTTLError",
        message: "Unable to save records with ttl equal to NaN",
      });
      expect(data).toBeNull();
    });

    test("should return InvalidTTLError on very large TTL", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis, ttl: Infinity });

      const [error, data] = await cache.set("user:1", { name: "John" });

      expect(error).toEqual({
        type: "InvalidTTLError",
        message: "Unable to save records with ttl equal to Infinity",
      });
      expect(data).toBeNull();
    });
  });

  describe("delete", () => {
    test("should delete an existing key", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      await redis.set("key", "value");
      expect(redis.getStore().has("key")).toBe(true);

      const [error, count] = await cache.delete("key");
      expect(error).toBeNull();
      expect(count).toBe(1);
      expect(redis.getStore().has("key")).toBe(false);
    });

    test("should return 0 when deleting non-existent key", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      const [error, count] = await cache.delete("nonexistent");
      expect(error).toBeNull();
      expect(count).toBe(0);
    });

    test("should return CacheError on Redis connection failure", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      redis.setShouldFail(true);

      const [error, data] = await cache.delete("key");
      expect(error).toEqual({
        type: "CacheError",
        message: "Unable to delete key key",
      });
      expect(data).toBeNull();
    });
  });

  describe("Integration scenarios", () => {
    test("should handle complete set-get-delete flow", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ id: number; name: string }>({
        redis,
      });

      // Set
      const [setError, setValue] = await cache.set("user:123", {
        id: 123,
        name: "Alice",
      });
      expect(setError).toBeNull();
      expect(setValue).toEqual({ id: 123, name: "Alice" });

      // Get
      const [getError, getValue] = await cache.get("user:123");
      expect(getError).toBeNull();
      expect(getValue).toEqual({ id: 123, name: "Alice" });

      // Delete
      const [delError, delCount] = await cache.delete("user:123");
      expect(delError).toBeNull();
      expect(delCount).toBe(1);

      // Verify deleted
      const [notFoundError] = await cache.get("user:123");
      expect(notFoundError?.type).toBe("NotFoundError");
    });

    test("should handle multiple cache instances with same Redis client", async () => {
      const redis = createMockRedis();
      const cache1 = new Cache<string>({ redis });
      const cache2 = new Cache<string>({ redis });

      await cache1.set("shared", "value1");
      const [, value] = await cache2.get("shared");
      expect(value).toBe("value1");
    });

    test("should handle cache with TTL option", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, ttl: 1000 });

      const [error, data] = await cache.set("expiring", "value");
      expect(error).toBeNull();
      expect(data).toBe("value");

      const [, retrieved] = await cache.get("expiring");
      expect(retrieved).toBe("value");
    });

    test("should overwrite existing keys", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      await cache.set("key", "value1");
      const [, first] = await cache.get("key");
      expect(first).toBe("value1");

      await cache.set("key", "value2");
      const [, second] = await cache.get("key");
      expect(second).toBe("value2");
    });
  });
});

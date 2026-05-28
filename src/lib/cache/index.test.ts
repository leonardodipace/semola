import { describe, expect, test } from "bun:test";
import { Cache } from "./index.js";

// Mock Redis client for testing
class MockRedisClient {
  private store = new Map<string, string>();
  private shouldFail = false;
  private lastSetOptions: { mode?: string; ttl?: number } | null = null;

  public setShouldFail(value: boolean) {
    this.shouldFail = value;
  }

  public async get(key: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    return this.store.get(key);
  }

  public async set(key: string, value: string, mode?: string, ttl?: number) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    this.lastSetOptions = { mode, ttl };

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

  public getLastSetOptions() {
    return this.lastSetOptions;
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

      const data = await cache.get("user:1");
      expect(data).toEqual({ name: "John" });
    });

    test("should throw NotFoundError when key does not exist", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      const promise = cache.get("nonexistent");
      await expect(promise).rejects.toMatchObject({
        name: "NotFoundError",
        message: "Key nonexistent not found",
      });
    });

    test("should throw CacheError on Redis connection failure", async () => {
      const redis = createMockRedis();
      redis.setShouldFail(true);
      const cache = new Cache<string>({ redis });

      const promise = cache.get("key");
      await expect(promise).rejects.toMatchObject({
        name: "CacheError",
        message: "Unable to get value for key key",
      });
    });

    test("should throw DeserializationError on invalid JSON", async () => {
      const redis = createMockRedis();
      const cache = new Cache<object>({ redis });

      await redis.set("invalid", "not valid json {");

      const promise = cache.get("invalid");
      await expect(promise).rejects.toMatchObject({
        name: "DeserializationError",
        message: "Unable to deserialize value for key invalid",
      });
    });

    test("should work with different data types", async () => {
      const redis = createMockRedis();

      // Test with number
      const numberCache = new Cache<number>({ redis });
      await redis.set("number", "42");
      expect(await numberCache.get("number")).toBe(42);

      // Test with boolean
      const boolCache = new Cache<boolean>({ redis });
      await redis.set("bool", "true");
      expect(await boolCache.get("bool")).toBe(true);

      // Test with array
      const arrayCache = new Cache<number[]>({ redis });
      await redis.set("array", JSON.stringify([1, 2, 3]));
      expect(await arrayCache.get("array")).toEqual([1, 2, 3]);

      // Test with nested object
      const objCache = new Cache<{ user: { name: string; age: number } }>({
        redis,
      });
      await redis.set(
        "nested",
        JSON.stringify({ user: { name: "Alice", age: 30 } }),
      );
      expect(await objCache.get("nested")).toEqual({
        user: { name: "Alice", age: 30 },
      });
    });
  });

  describe("set", () => {
    test("should store a value in cache", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis });

      const data = await cache.set("user:1", { name: "John" });
      expect(data).toEqual({ name: "John" });

      const stored = redis.getStore().get("user:1");
      expect(stored).toBe(JSON.stringify({ name: "John" }));
    });

    test("should handle NaN", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ id: number }>({ redis });

      const data = await cache.set("user:id", { id: NaN });
      expect(data).toEqual({ id: NaN });

      const stored = redis.getStore().get("user:id");
      expect(stored).toBe(JSON.stringify({ id: NaN }));
    });

    test("should store value with TTL when provided", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, ttl: 5000 });

      const data = await cache.set("key", "value");
      expect(data).toBe("value");
      expect(redis.getLastSetOptions()).toEqual({ mode: "PX", ttl: 5000 });
    });

    test("should store value with TTL equal to 0", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, ttl: 0 });

      const data = await cache.set("key", "value");
      expect(data).toBe("value");
      expect(redis.getLastSetOptions()).toEqual({ mode: "PX", ttl: 0 });
    });

    test("should throw SerializationError on stringify failure", async () => {
      const redis = createMockRedis();
      type CircularType = { a: number; self?: CircularType };
      const cache = new Cache<CircularType>({ redis });

      // Create circular reference that cannot be stringified
      const circular: CircularType = { a: 1 };
      circular.self = circular;

      const promise = cache.set("circular", circular);
      await expect(promise).rejects.toMatchObject({
        name: "SerializationError",
        message: "Unable to serialize value for key circular",
      });
    });

    test("should throw CacheError on Redis connection failure", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      redis.setShouldFail(true);

      const promise = cache.set("key", "value");
      await expect(promise).rejects.toMatchObject({
        name: "CacheError",
        message: "Unable to set value for key key",
      });
    });

    test("should work with different data types", async () => {
      const redis = createMockRedis();

      // Number
      const numCache = new Cache<number>({ redis });
      expect(await numCache.set("num", 42)).toBe(42);
      expect(redis.getStore().get("num")).toBe("42");

      // Boolean
      const boolCache = new Cache<boolean>({ redis });
      expect(await boolCache.set("bool", false)).toBe(false);
      expect(redis.getStore().get("bool")).toBe("false");

      // Array
      const arrCache = new Cache<string[]>({ redis });
      expect(await arrCache.set("arr", ["a", "b", "c"])).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(redis.getStore().get("arr")).toBe('["a","b","c"]');

      // Object
      const objCache = new Cache<{ key: string }>({ redis });
      expect(await objCache.set("obj", { key: "value" })).toEqual({
        key: "value",
      });
      expect(redis.getStore().get("obj")).toBe('{"key":"value"}');
    });

    test("should throw InvalidTTLError on negative TTL", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis, ttl: -1 });

      const promise = cache.set("user:1", { name: "John" });
      await expect(promise).rejects.toMatchObject({
        name: "InvalidTTLError",
        message: "Unable to save records with ttl equal to -1",
      });
    });

    test("should throw InvalidTTLError on non integer TTL", async () => {
      const redis = createMockRedis();
      const nonIntegerTTL = 0.1 + 0.2;
      const cache = new Cache<{ name: string }>({ redis, ttl: nonIntegerTTL });

      const promise = cache.set("user:1", { name: "John" });
      await expect(promise).rejects.toMatchObject({
        name: "InvalidTTLError",
        message: `Unable to save records with ttl equal to ${nonIntegerTTL}`,
      });
    });

    test("should throw InvalidTTLError on NaN TTL", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis, ttl: NaN });

      const promise = cache.set("user:1", { name: "John" });
      await expect(promise).rejects.toMatchObject({
        name: "InvalidTTLError",
        message: "Unable to save records with ttl equal to NaN",
      });
    });

    test("should throw InvalidTTLError on very large TTL", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({ redis, ttl: Infinity });

      const promise = cache.set("user:1", { name: "John" });
      await expect(promise).rejects.toMatchObject({
        name: "InvalidTTLError",
        message: "Unable to save records with ttl equal to Infinity",
      });
    });
  });

  describe("delete", () => {
    test("should delete an existing key", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      await redis.set("key", "value");
      expect(redis.getStore().has("key")).toBe(true);

      const count = await cache.delete("key");
      expect(count).toBe(1);
      expect(redis.getStore().has("key")).toBe(false);
    });

    test("should return 0 when deleting non-existent key", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      const count = await cache.delete("nonexistent");
      expect(count).toBe(0);
    });

    test("should throw CacheError on Redis connection failure", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      redis.setShouldFail(true);

      const promise = cache.delete("key");
      await expect(promise).rejects.toMatchObject({
        name: "CacheError",
        message: "Unable to delete key key",
      });
    });
  });

  describe("enabled", () => {
    test("get should throw NotFoundError when disabled", async () => {
      const redis = createMockRedis();
      await redis.set("key", JSON.stringify("value"));
      const cache = new Cache<string>({ redis, enabled: false });

      const promise = cache.get("key");
      await expect(promise).rejects.toMatchObject({
        name: "NotFoundError",
        message: "Key key not found",
      });
    });

    test("set should return value without storing when disabled", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, enabled: false });

      const data = await cache.set("key", "value");
      expect(data).toBe("value");
      expect(redis.getStore().has("key")).toBe(false);
    });

    test("delete should return 0 without deleting when disabled", async () => {
      const redis = createMockRedis();
      await redis.set("key", "value");
      const cache = new Cache<string>({ redis, enabled: false });

      const count = await cache.delete("key");
      expect(count).toBe(0);
      expect(redis.getStore().has("key")).toBe(true);
    });

    test("should work normally when enabled is true", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, enabled: true });

      await cache.set("key", "value");

      const data = await cache.get("key");
      expect(data).toBe("value");
    });

    test("should work normally when enabled is not provided", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      await cache.set("key", "value");

      const data = await cache.get("key");
      expect(data).toBe("value");
    });
  });

  describe("prefix", () => {
    test("get should use prefixed key in Redis", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, prefix: "users" });

      await redis.set("users:123", JSON.stringify("John"));

      const data = await cache.get("123");
      expect(data).toBe("John");
    });

    test("set should store with prefixed key in Redis", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, prefix: "users" });

      await cache.set("123", "John");
      expect(redis.getStore().has("users:123")).toBe(true);
      expect(redis.getStore().has("123")).toBe(false);
    });

    test("delete should delete with prefixed key in Redis", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, prefix: "users" });

      await redis.set("users:123", JSON.stringify("John"));

      const count = await cache.delete("123");
      expect(count).toBe(1);
      expect(redis.getStore().has("users:123")).toBe(false);
    });

    test("should not prefix when option is not provided", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      await cache.set("123", "John");
      expect(redis.getStore().has("123")).toBe(true);
    });
  });

  describe("serializer/deserializer", () => {
    test("should use custom serializer on set", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({
        redis,
        serializer: (value) => `custom:${value.name}`,
      });

      const data = await cache.set("key", { name: "John" });
      expect(data).toEqual({ name: "John" });
      expect(redis.getStore().get("key")).toBe("custom:John");
    });

    test("should allow custom serializer to return empty string", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        serializer: () => "",
      });

      const data = await cache.set("key", "value");
      expect(data).toBe("value");
      expect(redis.getStore().get("key")).toBe("");
    });

    test("should not treat empty string value as cache miss", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        serializer: () => "",
        deserializer: (raw) => raw,
      });

      await cache.set("key", "value");

      const data = await cache.get("key");
      expect(data).toBe("");
    });

    test("should use custom deserializer on get", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ name: string }>({
        redis,
        deserializer: (raw) => ({ name: raw.replace("custom:", "") }),
      });

      await redis.set("key", "custom:John");

      const data = await cache.get("key");
      expect(data).toEqual({ name: "John" });
    });

    test("should throw SerializationError when serializer throws", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        serializer: () => {
          throw new Error("serializer failed");
        },
      });

      const promise = cache.set("key", "value");
      await expect(promise).rejects.toMatchObject({
        name: "SerializationError",
        message: "Unable to serialize value for key key",
      });
    });

    test("should throw DeserializationError when deserializer throws", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        deserializer: () => {
          throw new Error("deserializer failed");
        },
      });

      await redis.set("key", "value");

      const promise = cache.get("key");
      await expect(promise).rejects.toMatchObject({
        name: "DeserializationError",
        message: "Unable to deserialize value for key key",
      });
    });
  });

  describe("ttl as function", () => {
    test("should use TTL returned by function", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ priority: string }>({
        redis,
        ttl: (_key, value) => (value.priority === "high" ? 60000 : 5000),
      });

      const data = await cache.set("item", { priority: "high" });
      expect(data).toEqual({ priority: "high" });
    });

    test("should pass key and value to TTL function", async () => {
      const redis = createMockRedis();
      let receivedKey: string | undefined;
      let receivedValue: string | undefined;

      const cache = new Cache<string>({
        redis,
        ttl: (key, value) => {
          receivedKey = key;
          receivedValue = value;
          return 1000;
        },
      });

      await cache.set("myKey", "myValue");

      expect(receivedKey).toBe("myKey");
      expect(receivedValue).toBe("myValue");
    });

    test("should throw InvalidTTLError when function returns invalid TTL", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        ttl: () => -1,
      });

      const promise = cache.set("key", "value");
      await expect(promise).rejects.toMatchObject({
        name: "InvalidTTLError",
        message: "Unable to save records with ttl equal to -1",
      });
    });

    test("should throw InvalidTTLError when function throws", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        ttl: () => {
          throw new Error("ttl failed");
        },
      });

      const promise = cache.set("key", "value");
      await expect(promise).rejects.toMatchObject({
        name: "InvalidTTLError",
        message: "Unable to resolve ttl for key key",
      });
    });
  });

  describe("Integration scenarios", () => {
    test("should handle complete set-get-delete flow", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ id: number; name: string }>({ redis });

      // Set
      const setValue = await cache.set("user:123", { id: 123, name: "Alice" });
      expect(setValue).toEqual({ id: 123, name: "Alice" });

      // Get
      const getValue = await cache.get("user:123");
      expect(getValue).toEqual({ id: 123, name: "Alice" });

      // Delete
      const delCount = await cache.delete("user:123");
      expect(delCount).toBe(1);

      // Verify deleted
      const promise = cache.get("user:123");
      await expect(promise).rejects.toMatchObject({
        name: "NotFoundError",
      });
    });

    test("should handle multiple cache instances with same Redis client", async () => {
      const redis = createMockRedis();
      const cache1 = new Cache<string>({ redis });
      const cache2 = new Cache<string>({ redis });

      await cache1.set("shared", "value1");
      expect(await cache2.get("shared")).toBe("value1");
    });

    test("should handle cache with TTL option", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, ttl: 1000 });

      const data = await cache.set("expiring", "value");
      expect(data).toBe("value");

      expect(await cache.get("expiring")).toBe("value");
    });

    test("should overwrite existing keys", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      await cache.set("key", "value1");
      expect(await cache.get("key")).toBe("value1");

      await cache.set("key", "value2");
      expect(await cache.get("key")).toBe("value2");
    });
  });
});

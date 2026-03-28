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

    test("should return null when key does not exist", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      const data = await cache.get("nonexistent");

      expect(data).toBeNull();
    });

    test("should return null when disabled", async () => {
      const redis = createMockRedis();
      await redis.set("key", JSON.stringify("value"));
      const cache = new Cache<string>({ redis, enabled: false });

      const data = await cache.get("key");

      expect(data).toBeNull();
    });

    test("should bubble Redis connection failures", async () => {
      const redis = createMockRedis();
      redis.setShouldFail(true);
      const cache = new Cache<string>({ redis });

      await expect(cache.get("key")).rejects.toThrow("Redis connection error");
    });

    test("should bubble deserializer errors", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        deserializer: () => {
          throw new Error("deserializer failed");
        },
      });

      await redis.set("key", "value");

      await expect(cache.get("key")).rejects.toThrow("deserializer failed");
    });

    test("should work with different data types", async () => {
      const redis = createMockRedis();

      const numberCache = new Cache<number>({ redis });
      await redis.set("number", "42");
      const num = await numberCache.get("number");
      expect(num).toBe(42);

      const boolCache = new Cache<boolean>({ redis });
      await redis.set("bool", "true");
      const bool = await boolCache.get("bool");
      expect(bool).toBe(true);

      const arrayCache = new Cache<number[]>({ redis });
      await redis.set("array", JSON.stringify([1, 2, 3]));
      const arr = await arrayCache.get("array");
      expect(arr).toEqual([1, 2, 3]);

      const objCache = new Cache<{ user: { name: string; age: number } }>({
        redis,
      });
      await redis.set(
        "nested",
        JSON.stringify({ user: { name: "Alice", age: 30 } }),
      );
      const obj = await objCache.get("nested");
      expect(obj).toEqual({ user: { name: "Alice", age: 30 } });
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

    test("should return the value without storing when disabled", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, enabled: false });

      const data = await cache.set("key", "value");

      expect(data).toBe("value");
      expect(redis.getStore().has("key")).toBe(false);
    });

    test("should bubble serializer failures", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        serializer: () => {
          throw new Error("serializer failed");
        },
      });

      await expect(cache.set("key", "value")).rejects.toThrow(
        "serializer failed",
      );
    });

    test("should bubble Redis connection failures", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      redis.setShouldFail(true);

      await expect(cache.set("key", "value")).rejects.toThrow(
        "Redis connection error",
      );
    });

    test("should work with different data types", async () => {
      const redis = createMockRedis();

      const numCache = new Cache<number>({ redis });
      const num = await numCache.set("num", 42);
      expect(num).toBe(42);
      expect(redis.getStore().get("num")).toBe("42");

      const boolCache = new Cache<boolean>({ redis });
      const bool = await boolCache.set("bool", false);
      expect(bool).toBe(false);
      expect(redis.getStore().get("bool")).toBe("false");

      const arrCache = new Cache<string[]>({ redis });
      const arr = await arrCache.set("arr", ["a", "b", "c"]);
      expect(arr).toEqual(["a", "b", "c"]);
      expect(redis.getStore().get("arr")).toBe('["a","b","c"]');

      const objCache = new Cache<{ key: string }>({
        redis,
      });
      const obj = await objCache.set("obj", { key: "value" });
      expect(obj).toEqual({ key: "value" });
      expect(redis.getStore().get("obj")).toBe('{"key":"value"}');
    });

    test("should bubble ttl function failures", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({
        redis,
        ttl: () => {
          throw new Error("ttl failed");
        },
      });

      await expect(cache.set("key", "value")).rejects.toThrow("ttl failed");
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

    test("should return 0 without deleting when disabled", async () => {
      const redis = createMockRedis();
      await redis.set("key", "value");
      const cache = new Cache<string>({ redis, enabled: false });

      const count = await cache.delete("key");

      expect(count).toBe(0);
      expect(redis.getStore().has("key")).toBe(true);
    });

    test("should bubble Redis connection failures", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      redis.setShouldFail(true);

      await expect(cache.delete("key")).rejects.toThrow(
        "Redis connection error",
      );
    });
  });

  describe("prefix", () => {
    test("should use prefixed keys for get, set, and delete", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, prefix: "users" });

      await cache.set("123", "John");

      expect(redis.getStore().has("users:123")).toBe(true);
      expect(redis.getStore().has("123")).toBe(false);

      const data = await cache.get("123");
      expect(data).toBe("John");

      const count = await cache.delete("123");
      expect(count).toBe(1);
      expect(redis.getStore().has("users:123")).toBe(false);
    });
  });

  describe("serializer and deserializer", () => {
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
  });

  describe("integration scenarios", () => {
    test("should handle complete set-get-delete flow", async () => {
      const redis = createMockRedis();
      const cache = new Cache<{ id: number; name: string }>({
        redis,
      });

      const setValue = await cache.set("user:123", {
        id: 123,
        name: "Alice",
      });
      expect(setValue).toEqual({ id: 123, name: "Alice" });

      const getValue = await cache.get("user:123");
      expect(getValue).toEqual({ id: 123, name: "Alice" });

      const delCount = await cache.delete("user:123");
      expect(delCount).toBe(1);

      const missingValue = await cache.get("user:123");
      expect(missingValue).toBeNull();
    });

    test("should handle multiple cache instances with same Redis client", async () => {
      const redis = createMockRedis();
      const cache1 = new Cache<string>({ redis });
      const cache2 = new Cache<string>({ redis });

      await cache1.set("shared", "value1");
      const value = await cache2.get("shared");
      expect(value).toBe("value1");
    });

    test("should handle cache with TTL option", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis, ttl: 1000 });

      const data = await cache.set("expiring", "value");
      expect(data).toBe("value");

      const retrieved = await cache.get("expiring");
      expect(retrieved).toBe("value");
    });

    test("should overwrite existing keys", async () => {
      const redis = createMockRedis();
      const cache = new Cache<string>({ redis });

      await cache.set("key", "value1");
      const first = await cache.get("key");
      expect(first).toBe("value1");

      await cache.set("key", "value2");
      const second = await cache.get("key");
      expect(second).toBe("value2");
    });
  });
});

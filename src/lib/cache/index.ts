import type { CacheOptions } from "./types.js";

export class Cache<T> {
  private options: CacheOptions<T>;
  private serialize: (value: T) => string;
  private deserialize: (raw: string) => T;

  public constructor(options: CacheOptions<T>) {
    this.options = options;
    this.serialize = options.serializer ?? JSON.stringify;
    this.deserialize = options.deserializer ?? ((raw) => JSON.parse(raw));
  }

  public async get(key: string) {
    if (!this.isEnabled) return null;

    const resolvedKey = this.resolveKey(key);

    const value = await this.options.redis.get(resolvedKey);

    if (value === null || value === undefined) {
      return null;
    }

    const deserialized = this.deserialize(value);

    return deserialized;
  }

  public async set(key: string, value: T) {
    if (!this.isEnabled) return value;

    const serialized = this.serialize(value);

    const ttl = this.resolveTTL(key, value);

    const resolvedKey = this.resolveKey(key);

    await this.getSetPromise(resolvedKey, serialized, ttl);

    return value;
  }

  public async delete(key: string) {
    if (!this.isEnabled) return 0;

    const resolvedKey = this.resolveKey(key);

    const data = this.options.redis.del(resolvedKey);

    return data;
  }

  private get isEnabled() {
    return this.options.enabled !== false;
  }

  private resolveKey(key: string) {
    if (this.options.prefix) {
      return `${this.options.prefix}:${key}`;
    }

    return key;
  }

  private resolveTTL(key: string, value: T) {
    if (typeof this.options.ttl === "function") {
      return this.options.ttl(key, value);
    }

    return this.options.ttl;
  }

  private getSetPromise(
    key: string,
    value: string,
    ttl: number | undefined | null,
  ) {
    if (ttl === undefined || ttl === null) {
      return this.options.redis.set(key, value);
    }

    return this.options.redis.set(key, value, "PX", ttl);
  }
}

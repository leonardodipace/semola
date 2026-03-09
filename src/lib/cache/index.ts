import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type { CacheError, CacheOptions } from "./types.js";

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
    if (!this.isEnabled) {
      return this.fail("NotFoundError", `Key ${key} not found`);
    }

    const resolvedKey = this.resolveKey(key);

    const [error, value] = await mightThrow(
      this.options.redis.get(resolvedKey),
    );

    if (error) {
      return this.fail("CacheError", `Unable to get value for key ${key}`);
    }

    if (value === null || value === undefined) {
      return this.fail("NotFoundError", `Key ${key} not found`);
    }

    const [deserializeErr, deserialized] = mightThrowSync<T>(() =>
      this.deserialize(value),
    );

    if (deserializeErr) {
      return this.fail(
        "CacheError",
        `Unable to deserialize value for key ${key}`,
      );
    }

    return ok(deserialized);
  }

  public async set(key: string, value: T) {
    if (!this.isEnabled) {
      return ok(value);
    }

    const [serializeErr, serialized] = mightThrowSync(() =>
      this.serialize(value),
    );

    if (serializeErr) {
      return this.fail(
        "CacheError",
        `Unable to serialize value for key ${key}`,
      );
    }

    if (serialized === null || serialized === undefined) {
      return this.fail(
        "CacheError",
        `Unable to serialize value for key ${key}`,
      );
    }

    const [ttlErr, ttl] = mightThrowSync(() => this.resolveTTL(key, value));

    if (ttlErr) {
      return this.fail(
        "InvalidTTLError",
        `Unable to resolve ttl for key ${key}`,
      );
    }

    if (!this.isTTLValid(ttl)) {
      return this.fail(
        "InvalidTTLError",
        `Unable to save records with ttl equal to ${ttl}`,
      );
    }

    const resolvedKey = this.resolveKey(key);

    const setPromise = this.getSetPromise(resolvedKey, serialized, ttl);

    const [setError] = await mightThrow(setPromise);

    if (setError) {
      return this.fail("CacheError", `Unable to set value for key ${key}`);
    }

    return ok(value);
  }

  public async delete(key: string) {
    if (!this.isEnabled) {
      return ok(0);
    }

    const resolvedKey = this.resolveKey(key);

    const [error, data] = await mightThrow(this.options.redis.del(resolvedKey));

    if (error) {
      return this.fail("CacheError", `Unable to delete key ${key}`);
    }

    return ok(data);
  }

  private fail<E extends CacheError>(type: E, message: string) {
    this.options.onError?.({ type, message });

    return err(type, message);
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

  private isTTLValid(ttl: number | undefined | null) {
    if (ttl === undefined || ttl === null) return true;

    if (!Number.isFinite(ttl)) return false;

    if (!Number.isInteger(ttl)) return false;

    if (ttl < 0) return false;

    return true;
  }
}

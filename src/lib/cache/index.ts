import { mightThrow, mightThrowSync } from "../errors/index.js";
import {
  CacheError,
  DeserializationError,
  InvalidTTLError,
  NotFoundError,
  SerializationError,
} from "./errors.js";
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
    if (!this.isEnabled) {
      throw new NotFoundError(`Key ${key} not found`);
    }

    const resolvedKey = this.resolveKey(key);

    const [error, value] = await mightThrow(
      this.options.redis.get(resolvedKey),
    );

    if (error) {
      throw new CacheError(`Unable to get value for key ${key}`);
    }

    if (value === null || value === undefined) {
      throw new NotFoundError(`Key ${key} not found`);
    }

    const [deserializeErr, deserialized] = mightThrowSync<T>(() =>
      this.deserialize(value),
    );

    if (deserializeErr) {
      throw new DeserializationError(
        `Unable to deserialize value for key ${key}`,
      );
    }

    return deserialized;
  }

  public async set(key: string, value: T) {
    if (!this.isEnabled) {
      return value;
    }

    const [serializeErr, serialized] = mightThrowSync(() =>
      this.serialize(value),
    );

    if (serializeErr) {
      throw new SerializationError(`Unable to serialize value for key ${key}`);
    }

    if (serialized === null || serialized === undefined) {
      throw new SerializationError(`Unable to serialize value for key ${key}`);
    }

    const [ttlErr, ttl] = mightThrowSync(() => this.resolveTTL(key, value));

    if (ttlErr) {
      throw new InvalidTTLError(`Unable to resolve ttl for key ${key}`);
    }

    if (!this.isTTLValid(ttl)) {
      throw new InvalidTTLError(
        `Unable to save records with ttl equal to ${ttl}`,
      );
    }

    const resolvedKey = this.resolveKey(key);

    const setPromise = this.getSetPromise(resolvedKey, serialized, ttl);

    const [setError] = await mightThrow(setPromise);

    if (setError) {
      throw new CacheError(`Unable to set value for key ${key}`);
    }

    return value;
  }

  public async delete(key: string) {
    if (!this.isEnabled) {
      return 0;
    }

    const resolvedKey = this.resolveKey(key);

    const [error, data] = await mightThrow(this.options.redis.del(resolvedKey));

    if (error) {
      throw new CacheError(`Unable to delete key ${key}`);
    }

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

  private isTTLValid(ttl: number | undefined | null) {
    if (ttl === undefined || ttl === null) return true;

    if (!Number.isFinite(ttl)) return false;

    if (!Number.isInteger(ttl)) return false;

    if (ttl < 0) return false;

    return true;
  }
}

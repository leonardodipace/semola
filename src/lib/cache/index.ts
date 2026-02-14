import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type { CacheOptions } from "./types.js";

export class Cache<T> {
  private options: CacheOptions;

  public constructor(options: CacheOptions) {
    this.options = options;
  }

  public async get(key: string) {
    if (!this.isEnabled) {
      return err("NotFoundError", `Key ${key} not found`);
    }

    const resolvedKey = this.resolveKey(key);

    const [error, value] = await mightThrow(
      this.options.redis.get(resolvedKey),
    );

    if (error) {
      return err("CacheError", `Unable to get value for key ${key}`);
    }

    if (!value) {
      return err("NotFoundError", `Key ${key} not found`);
    }

    const [parseError, parsed] = mightThrowSync<T>(() => JSON.parse(value));

    if (parseError) {
      return err("CacheError", `Unable to parse value for key ${key}`);
    }

    return ok(parsed);
  }

  public async set(key: string, value: T) {
    if (!this.isEnabled) {
      return ok(value);
    }

    const [stringifyError, stringified] = mightThrowSync(() =>
      JSON.stringify(value),
    );

    if (stringifyError) {
      return err("CacheError", `Unable to stringify value for key ${key}`);
    }

    if (!stringified) {
      return err("CacheError", `Unable to stringify value for key ${key}`);
    }

    if (!this.isTTLValid()) {
      return err(
        "InvalidTTLError",
        `Unable to save records with ttl equal to ${this.options.ttl}`,
      );
    }

    const resolvedKey = this.resolveKey(key);

    const [setError] = await mightThrow(
      this.options.ttl
        ? this.options.redis.set(
            resolvedKey,
            stringified,
            "PX",
            this.options.ttl,
          )
        : this.options.redis.set(resolvedKey, stringified),
    );

    if (setError) {
      return err("CacheError", `Unable to set value for key ${key}`);
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
      return err("CacheError", `Unable to delete key ${key}`);
    }

    return ok(data);
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

  private isTTLValid() {
    const { ttl } = this.options;

    if (ttl === undefined || ttl === null) return true;

    if (!Number.isFinite(ttl)) return false;

    if (!Number.isInteger(ttl)) return false;

    if (ttl < 0) return false;

    return true;
  }
}

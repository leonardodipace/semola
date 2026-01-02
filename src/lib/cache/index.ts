import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type { CacheOptions } from "./types.js";

export class Cache<T> {
  private options: CacheOptions;

  constructor(options: CacheOptions) {
    this.options = options;
  }

  public async get(key: string) {
    const [error, value] = await mightThrow(this.options.redis.get(key));

    if (error) {
      return err("CacheError", `Unable to get value for key ${key}`);
    }

    if (!value) {
      return err("NotFoundError", `Key ${key} not found`);
    }

    const [parseError, parsed] = mightThrowSync(() => JSON.parse(value));

    if (parseError) {
      return err("CacheError", `Unable to parse value for key ${key}`);
    }

    return ok(parsed as T);
  }

  public async set(key: string, value: T) {
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

    const [setError] = await mightThrow(
      this.options.ttl
        ? this.options.redis.set(key, stringified, "PX", this.options.ttl)
        : this.options.redis.set(key, stringified),
    );

    if (setError) {
      return err("CacheError", `Unable to set value for key ${key}`);
    }

    return ok(value);
  }

  public async delete(key: string) {
    const [error, data] = await mightThrow(this.options.redis.del(key));

    if (error) {
      return err("CacheError", `Unable to delete key ${key}`);
    }

    return ok(data);
  }

  private isTTLValid() {
    const { ttl } = this.options;

    if (ttl === undefined || ttl === null) return true;

    // ttl is now set to a numeric value insted of not being provided
    // inside the options.

    if (!Number.isFinite(ttl)) return false;

    if (!Number.isInteger(ttl)) return false;

    if (ttl < 0) return false;

    return true;
  }
}

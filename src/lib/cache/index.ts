import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js"

export type CacheOptions = {
  redis: Bun.RedisClient
  ttl?: number
}

export class Cache<T> {
  private options: CacheOptions

  constructor(options: CacheOptions) {
    this.options = options
  }

  public async get(key: string) {
    const [error, value] = await mightThrow(this.options.redis.get(key))

    if (error) {
      return err("CacheError", `Unable to get value for key ${key}`)
    }

    if (!value) {
      return err("NotFoundError", `Key ${key} not found`)
    }

    const [parseError, parsed] = mightThrowSync(() => JSON.parse(value))

    if (parseError) {
      return err("CacheError", `Unable to parse value for key ${key}`)
    }

    return ok(parsed as T)
  }

  public async set(key: string, value: T) {
    const [stringifyError, stringified] = mightThrowSync(() =>
      JSON.stringify(value),
    )

    if (stringifyError) {
      return err("CacheError", `Unable to stringify value for key ${key}`)
    }

    if (!stringified) {
      return err("CacheError", `Unable to stringify value for key ${key}`)
    }

    const [setError] = await mightThrow(
      this.options.ttl
        ? this.options.redis.set(key, stringified, "PX", this.options.ttl)
        : this.options.redis.set(key, stringified),
    )

    if (setError) {
      return err("CacheError", `Unable to set value for key ${key}`)
    }

    return ok(value)
  }

  public async delete(key: string) {
    const [error, data] = await mightThrow(this.options.redis.del(key))

    if (error) {
      return err("CacheError", `Unable to delete key ${key}`)
    }

    return ok(data)
  }
}

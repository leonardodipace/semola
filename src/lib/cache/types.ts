import type { RedisInput } from "../redis/types.js";

export type CacheOptions<T> = {
  redis: RedisInput;
  ttl?: number | ((key: string, value: T) => number);
  enabled?: boolean;
  prefix?: string;
  serializer?: (value: T) => string;
  deserializer?: (raw: string) => T;
};

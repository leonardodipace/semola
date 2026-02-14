type CacheError = "CacheError" | "InvalidTTLError";

export type CacheOptions<T> = {
  redis: Bun.RedisClient;
  ttl?: number | ((key: string, value: T) => number);
  enabled?: boolean;
  prefix?: string;
  serializer?: (value: T) => string;
  deserializer?: (raw: string) => T;
  onError?: (error: { type: CacheError; message: string }) => void;
};
